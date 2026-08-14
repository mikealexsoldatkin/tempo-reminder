import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  Heading,
  Inline,
  InlineEdit,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';

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
 * @param {Array<{key: string, header: string, renderCell: (person: object) => JSX.Element}>} [props.extraColumns]
 * @param {boolean} [props.showContact] показывать ли email и найденный Slack-id.
 *   Выключается там, где сообщение уходит не самому человеку: пустая колонка «Slack»
 *   у того, кому и не пишут, читалась бы как ненайденный аккаунт.
 */
export const PeopleTable = ({
  title,
  people,
  emptyMessage,
  onRemove,
  onSetEmail,
  extraColumns = [],
  showContact = true,
}) => {
  const [selected, setSelected] = useState(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (accountId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const mutate = async (action) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      setSelected(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const head = {
    cells: [
      { key: 'select', content: '', width: 5 },
      { key: 'name', content: 'Name' },
      ...(showContact ? [{ key: 'email', content: 'Email for Slack lookup' }] : []),
      ...extraColumns.map(({ key, header }) => ({ key, content: header })),
      ...(showContact ? [{ key: 'slack', content: 'Slack' }] : []),
      { key: 'actions', content: '', width: 10 },
    ],
  };

  const rows = people.map((person) => ({
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
      { key: 'name', content: <Text>{person.displayName}</Text> },
      ...(showContact
        ? [
            {
              key: 'email',
              content: (
                <EmailCell
                  email={person.email}
                  onConfirm={(value) => mutate(() => onSetEmail(person.accountId, value))}
                />
              ),
            },
          ]
        : []),
      ...extraColumns.map(({ key, renderCell }) => ({ key, content: renderCell(person) })),
      ...(showContact
        ? [
            {
              key: 'slack',
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
            onClick={() => mutate(() => onRemove([person.accountId]))}
          >
            Remove
          </Button>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">{title} ({people.length})</Heading>

      {people.length === 0 && (
        <SectionMessage appearance="warning">
          <Text>{emptyMessage}</Text>
        </SectionMessage>
      )}

      {people.length > 0 && (
        <Box>
          <DynamicTable head={head} rows={rows} rowsPerPage={20} isLoading={isBusy} />
        </Box>
      )}

      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {people.length > 0 && (
        <Inline space="space.100">
          <LoadingButton
            appearance="danger"
            isLoading={isBusy}
            isDisabled={selected.size === 0}
            onClick={() => mutate(() => onRemove([...selected]))}
          >
            Remove selected ({selected.size})
          </LoadingButton>
          <Button appearance="subtle" isDisabled={selected.size === 0} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </Inline>
      )}
    </Stack>
  );
};
