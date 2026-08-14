import React from 'react';
import { Button, Inline, LoadingButton, SectionMessage, Stack, Text } from '@forge/react';
import { CandidateTable } from './CandidateTable';

/**
 * Результаты поиска и действия над отмеченными — общий блок для поиска по имени
 * и по ключу проекта: обе секции отличаются только тем, как ищут людей.
 *
 * Выделение одно на все действия: отмеченных можно поставить под наблюдение, завести
 * им детальный отчёт или назначить менеджерами. Это три независимых списка, и один
 * человек может попасть в любые из них.
 */
export const CandidateResults = ({
  search,
  trackedIds,
  detailedIds,
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
        detailedIds={detailedIds}
        managerIds={managerIds}
        showRoles={showRoles}
      />

      <Inline space="space.100">
        <LoadingButton
          appearance="primary"
          isLoading={search.busyAction === 'track'}
          isDisabled={search.selected.size === 0 || search.busyAction !== null}
          onClick={() => search.submitSelected('track')}
        >
          Track ({search.selected.size})
        </LoadingButton>
        <LoadingButton
          isLoading={search.busyAction === 'detailed'}
          isDisabled={search.selected.size === 0 || search.busyAction !== null}
          onClick={() => search.submitSelected('detailed')}
        >
          Track in detail ({search.selected.size})
        </LoadingButton>
        <LoadingButton
          isLoading={search.busyAction === 'manager'}
          isDisabled={search.selected.size === 0 || search.busyAction !== null}
          onClick={() => search.submitSelected('manager')}
        >
          Mark as a manager ({search.selected.size})
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
