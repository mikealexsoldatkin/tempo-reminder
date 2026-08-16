import React from 'react';
import { Button, Inline, LoadingButton, SectionMessage, Stack, Text } from '@forge/react';
import { CandidateTable } from './CandidateTable';

/**
 * Результаты поиска и действие над отмеченными — общий блок для поиска по имени
 * и по ключу проекта: обе секции отличаются только тем, как ищут людей.
 *
 * Действие ровно одно и задаётся тем, откуда окно открыли: из таблицы Managers
 * человек добавляется в менеджеры, из Tracked users — под наблюдение. Показывать
 * обе кнопки сразу значило бы спрашивать то, на что кнопка «Add manager» уже
 * ответила, поэтому кнопка называется просто «Add» — что именно она делает,
 * сказано в заголовке окна.
 *
 * Выделение после действия сохраняется: повторное добавление безопасно, а сбрасывать
 * отметки у списка, который пользователь ещё разглядывает, незачем.
 */
export const CandidateResults = ({
  search,
  action,
  trackedIds,
  managerIds,
  showRoles = false,
}) => {
  if (search.message && !(search.candidates && search.candidates.length > 0)) {
    return (
      <SectionMessage appearance={search.message.appearance}>
        <Text>{search.message.text}</Text>
      </SectionMessage>
    );
  }

  if (!search.candidates || search.candidates.length === 0) return null;

  return (
    <Stack space="space.100">
      {search.message && (
        <SectionMessage appearance={search.message.appearance}>
          <Text>{search.message.text}</Text>
        </SectionMessage>
      )}

      <CandidateTable
        candidates={search.candidates}
        selected={search.selected}
        onToggle={search.toggle}
        trackedIds={trackedIds}
        managerIds={managerIds}
        showRoles={showRoles}
      />

      <Inline space="space.100">
        <LoadingButton
          appearance="primary"
          isLoading={search.busyAction === action}
          isDisabled={search.selected.size === 0 || search.busyAction !== null}
          onClick={() => search.submitSelected(action)}
        >
          Add ({search.selected.size})
        </LoadingButton>
        <Button appearance="subtle" onClick={search.selectAll}>
          Select all
        </Button>
        <Button appearance="subtle" onClick={search.clearSelection}>
          Clear selection
        </Button>
      </Inline>
    </Stack>
  );
};
