import React, { useState } from 'react';
import {
  Button,
  Heading,
  Inline,
  Label,
  LoadingButton,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';
import { CandidateTable } from './CandidateTable';
import { useCandidateSearch } from './useCandidateSearch';

/**
 * Пакетное добавление по ключу проекта — аналог прежнего getProjectPeople():
 * подтягиваем всех, кого можно назначить на задачи проекта, и добавляем батчем.
 */
export const AddByProjectSection = ({ trackedIds, onUsersChange }) => {
  const [projectKey, setProjectKey] = useState('');
  const search = useCandidateSearch({
    search: (value) => api.searchProjectMembers(value),
    add: async (users) => {
      const result = await api.addTrackedUsers(users);
      onUsersChange(result.users);
      return result;
    },
  });

  const submit = () => search.runSearch(projectKey, { preselectUntracked: true, trackedIds });

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">Add project members</Heading>
      <Text>
        Loads the people from the project’s own roles — the same list you see in Project settings →
        People. Instance-wide roles are ignored, and the result doesn’t depend on the permission
        scheme. Anyone not tracked yet is ticked automatically — clear the ones you don’t need.
      </Text>

      <Label labelFor="project-key">Jira project key</Label>
      <Inline space="space.100" alignBlock="end">
        <Textfield
          id="project-key"
          width={200}
          value={projectKey}
          placeholder="For example: ABC"
          onChange={(e) => setProjectKey(e.target.value)}
        />
        <LoadingButton
          appearance="primary"
          isLoading={search.isSearching}
          isDisabled={projectKey.trim().length === 0}
          onClick={submit}
        >
          Load members
        </LoadingButton>
      </Inline>

      {search.message && (
        <SectionMessage appearance={search.message.appearance}>
          <Text>{search.message.text}</Text>
        </SectionMessage>
      )}

      {search.candidates && search.candidates.length > 0 && (
        <Stack space="space.100">
          <CandidateTable
            candidates={search.candidates}
            selected={search.selected}
            onToggle={search.toggle}
            trackedIds={trackedIds}
          />
          <Inline space="space.100">
            <LoadingButton
              appearance="primary"
              isLoading={search.isAdding}
              isDisabled={search.selected.size === 0}
              onClick={search.addSelected}
            >
              Add selected ({search.selected.size})
            </LoadingButton>
            <Button appearance="subtle" onClick={() => search.selectAll(trackedIds)}>
              Select all
            </Button>
            <Button appearance="subtle" onClick={search.clearSelection}>
              Clear selection
            </Button>
          </Inline>
        </Stack>
      )}
    </Stack>
  );
};
