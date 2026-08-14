import React from 'react';
import { Button, Inline, LoadingButton, SectionMessage, Stack, Text } from '@forge/react';
import { CandidateTable } from './CandidateTable';

/**
 * Результаты поиска и действия над отмеченными — общий блок для поиска по имени
 * и по ключу проекта: обе секции отличаются только тем, как ищут людей.
 *
 * Выделение одно на оба действия и после каждого сохраняется: один и тот же человек
 * может быть и отслеживаемым, и менеджером, поэтому «поставить под наблюдение» и
 * «назначить менеджером» можно нажать подряд, не отмечая его заново.
 */
export const CandidateResults = ({ search, trackedIds, managerIds, showRoles = false }) => {
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
          isLoading={search.busyAction === 'track'}
          isDisabled={search.selected.size === 0 || search.busyAction !== null}
          onClick={() => search.submitSelected('track')}
        >
          Track ({search.selected.size})
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
