import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  Heading,
  HelperMessage,
  Inline,
  InlineEdit,
  Label,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * DynamicTable не отдаёт содержимое ячейки на обычный рендер: если content —
 * элемент функционального компонента, таблица вызывает его прямо в своём рендере
 * (`content.type(content.props)`). Хуки такого компонента попадают в список хуков
 * самой таблицы, и их число начинает зависеть от числа строк — после добавления
 * или удаления человека React падает с «Rendered more/fewer hooks than expected»
 * (ошибки #310 и #300).
 *
 * Обёртка без собственных хуков — это то, что таблица вызовет вместо InlineEdit
 * (у него четыре useState). Сам InlineEdit остаётся элементом в возвращённом
 * дереве, монтируется обычным путём и держит своё состояние у себя.
 *
 * То же правило действует и для extraColumns: renderCell обязан возвращать либо
 * примитив UI Kit, либо компонент без хуков.
 */
const EmailCell = ({ email, onConfirm }) => (
  <InlineEdit
    defaultValue={email ?? ''}
    editView={(fieldProps) => <Textfield {...fieldProps} placeholder="name@company.com" />}
    readView={() => <Text>{email ?? '— set an email'}</Text>}
    onConfirm={onConfirm}
  />
);

// Поиск по таблице появляется только там, где глазами уже не находится. На пяти
// строках поле над таблицей — лишний элемент, на пятидесяти без него человека
// приходится искать листанием страниц по 20 строк.
const FILTER_FROM = 6;

// Сколько имён перечислить в окне подтверждения. Больше десятка — это уже не
// «проверь, что удаляешь», а простыня, которую не читают.
const NAMES_IN_CONFIRM = 10;

const matches = (person, needle) =>
  `${person.displayName} ${person.email ?? ''}`.toLowerCase().includes(needle);

/**
 * Список людей из Jira: удаление (по одному и батчем) и ручная правка email —
 * он нужен для поиска человека в Slack, а Jira отдаёт его только если профиль
 * не скрыт настройками приватности.
 *
 * Один и тот же компонент обслуживает все три списка людей: различаются они только
 * дополнительными колонками и вызываемыми ручками API.
 *
 * @param {object} props
 * @param {Array} props.people кого показываем
 * @param {(accountIds: string[]) => Promise<void>} props.onRemove
 * @param {(accountId: string, email: string) => Promise<void>} [props.onSetEmail]
 * @param {Array<{key: string, header: string,
 *   renderCell: (person: object, mutate: (action: () => Promise<void>) => Promise<void>) => JSX.Element}>} [props.extraColumns]
 *   renderCell получает `mutate` вторым аргументом и обязан заворачивать в него
 *   свои запросы: иначе ошибка сохранения превращается в необработанный rejection,
 *   ячейка молча откатывается, и пользователю не сказано ничего.
 * @param {boolean} [props.showContact] показывать ли email и найденный Slack-id.
 *   Выключается там, где сообщение уходит не самому человеку: пустая колонка «Slack»
 *   у того, кому и не пишут, читалась бы как ненайденный аккаунт.
 * @param {JSX.Element} [props.addActions] кнопки добавления людей — они встают в
 *   тот же ряд, что «Remove selected» и «Clear selection», первыми. Ряд поэтому
 *   рисуется и у пустой таблицы: иначе добавлять в неё было бы нечем.
 * @param {string} [props.removeWarning] чем ещё обернётся удаление, кроме исчезновения
 *   строки. Показывается в окне подтверждения — там, где его прочитают.
 */
export const PeopleTable = ({
  title,
  people,
  emptyMessage,
  onRemove,
  onSetEmail,
  extraColumns = [],
  showContact = true,
  addActions = null,
  removeWarning = null,
}) => {
  const [selected, setSelected] = useState(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  // Что подтверждаем: {accountIds, names}. Одна и та же форма и для строки, и для
  // батча — разницы для пользователя между ними нет, а для последствий тем более.
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const toggle = (accountId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const needle = query.trim().toLowerCase();
  const visible = needle ? people.filter((person) => matches(person, needle)) : people;

  // «Выделить всё» работает по видимому: при включённом фильтре галочка в шапке
  // означает «все найденные», а не «все вообще» — иначе она отмечала бы то, чего
  // на экране нет.
  const selectedVisible = visible.filter((person) => selected.has(person.accountId)).length;
  const areAllVisibleSelected = visible.length > 0 && selectedVisible === visible.length;

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const person of visible) {
        if (areAllVisibleSelected) next.delete(person.accountId);
        else next.add(person.accountId);
      }
      return next;
    });
  };

  // Заголовок таблицы задан текстом («Tracked users»), а id с пробелом не свяжет
  // Label с полем.
  const filterId = `filter-${title.toLowerCase().replace(/\s+/g, '-')}`;

  const nameOf = (accountId) =>
    people.find((person) => person.accountId === accountId)?.displayName ?? accountId;

  /**
   * Выделение сбрасывается только там, где строки исчезают. Правка email или
   * менеджеров выделение не трогает: отметить десяток человек и потерять отметки
   * из-за попутной правки одной ячейки — поведение, которого никто не ждёт.
   */
  const mutate = async (action, { clearSelection = false } = {}) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      if (clearSelection) setSelected(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const confirmRemoval = async () => {
    const { accountIds } = pendingRemoval;
    await mutate(() => onRemove(accountIds), { clearSelection: true });
    setPendingRemoval(null);
  };

  const head = {
    cells: [
      {
        key: 'select',
        width: 5,
        content: (
          <Checkbox
            isChecked={areAllVisibleSelected}
            isIndeterminate={selectedVisible > 0 && !areAllVisibleSelected}
            isDisabled={visible.length === 0}
            onChange={toggleAllVisible}
            label=""
          />
        ),
      },
      { key: 'name', content: 'Name', isSortable: true },
      ...(showContact
        ? [{ key: 'email', content: 'Email for Slack lookup', isSortable: true }]
        : []),
      ...extraColumns.map(({ key, header }) => ({ key, content: header })),
      ...(showContact ? [{ key: 'slack', content: 'Slack', isSortable: true }] : []),
      { key: 'actions', content: '', width: 10 },
    ],
  };

  // У сортируемых колонок ключ ячейки — это значение, по которому таблица
  // сортирует (её собственный контракт: content из элементов сравнивать нечем).
  // У остальных он остаётся именем колонки.
  const rows = visible.map((person) => ({
    key: person.accountId,
    cells: [
      {
        key: 'select',
        content: (
          <Checkbox
            isChecked={selected.has(person.accountId)}
            onChange={() => toggle(person.accountId)}
            label=""
          />
        ),
      },
      { key: person.displayName, content: <Text>{person.displayName}</Text> },
      ...(showContact
        ? [
            {
              key: person.email ?? '',
              content: (
                <EmailCell
                  email={person.email}
                  onConfirm={(value) => mutate(() => onSetEmail(person.accountId, value))}
                />
              ),
            },
          ]
        : []),
      ...extraColumns.map(({ key, renderCell }) => ({ key, content: renderCell(person, mutate) })),
      ...(showContact
        ? [
            {
              key: person.slackUserId ? 'found' : '—',
              content: (
                <Lozenge appearance={person.slackUserId ? 'success' : 'default'}>
                  {person.slackUserId ? 'found' : '—'}
                </Lozenge>
              ),
            },
          ]
        : []),
      {
        key: 'actions',
        content: (
          <Button
            appearance="subtle"
            iconBefore="trash"
            isDisabled={isBusy}
            onClick={() =>
              setPendingRemoval({
                accountIds: [person.accountId],
                names: [person.displayName],
              })
            }
          >
            Remove
          </Button>
        ),
      },
    ],
  }));

  const shownNames = pendingRemoval?.names.slice(0, NAMES_IN_CONFIRM) ?? [];
  const hiddenNames = (pendingRemoval?.names.length ?? 0) - shownNames.length;

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">{title} ({people.length})</Heading>

      {people.length === 0 && (
        <SectionMessage appearance="warning">
          <Text>{emptyMessage}</Text>
        </SectionMessage>
      )}

      {people.length >= FILTER_FROM && (
        <Stack space="space.050">
          <Label labelFor={filterId}>Find in this table</Label>
          <Textfield
            id={filterId}
            width={280}
            value={query}
            placeholder="Name or email"
            onChange={(e) => setQuery(e.target.value)}
          />
          <HelperMessage>
            {needle
              ? `Showing ${visible.length} of ${people.length}. Ticks made before you typed are kept — everything about to be removed is listed in the confirmation.`
              : 'Filters the rows below. Columns can also be sorted by clicking their headers.'}
          </HelperMessage>
        </Stack>
      )}

      {people.length > 0 && (
        <Box>
          <DynamicTable
            head={head}
            rows={rows}
            rowsPerPage={20}
            isLoading={isBusy}
            defaultSortKey="name"
            defaultSortOrder="ASC"
            emptyView={<Text>Nobody here matches “{query}”.</Text>}
          />
        </Box>
      )}

      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {(addActions || people.length > 0) && (
        <Inline space="space.100" alignBlock="center">
          {addActions}
          {people.length > 0 && (
            <Button
              appearance="danger"
              isDisabled={selected.size === 0 || isBusy}
              onClick={() =>
                setPendingRemoval({
                  accountIds: [...selected],
                  names: [...selected].map(nameOf),
                })
              }
            >
              Remove selected ({selected.size})
            </Button>
          )}
          {people.length > 0 && (
            <Button
              appearance="subtle"
              isDisabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          )}
        </Inline>
      )}

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        title={
          pendingRemoval?.accountIds.length === 1
            ? 'Remove this person?'
            : `Remove ${pendingRemoval?.accountIds.length} people?`
        }
        confirmLabel={
          pendingRemoval?.accountIds.length === 1
            ? 'Remove'
            : `Remove ${pendingRemoval?.accountIds.length}`
        }
        isBusy={isBusy}
        onConfirm={confirmRemoval}
        onCancel={() => setPendingRemoval(null)}
      >
        <Stack space="space.100">
          <Text>
            Removing from “{title}”: {shownNames.join(', ')}
            {hiddenNames > 0 ? ` and ${hiddenNames} more` : ''}.
          </Text>
          {removeWarning && <Text>{removeWarning}</Text>}
          <Text>This can’t be undone — adding them back is a new search.</Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
};
