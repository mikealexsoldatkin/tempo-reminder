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
 * Поиск пользователей Jira по First + Last name (Jira ищет и по email) и батчевое добавление.
 */
export const AddByNameSection = ({ trackedIds, onUsersChange }) => {
  const [query, setQuery] = useState('');
  const search = useCandidateSearch({
    search: (value) => api.searchUsersByName(value),
    add: async (users) => {
      const result = await api.addTrackedUsers(users);
      onUsersChange(result.users);
      return result;
    },
  });

  const submit = () => search.runSearch(query);

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">Search by name</Heading>
      <Text>
        Enter a first and last name (or part of one) — Jira searches by display name and email.
        Tick the people you need and add them in one go.
      </Text>

      <Label labelFor="user-name-query">User name</Label>
      <Inline space="space.100" alignBlock="end">
        <Textfield
          id="user-name-query"
          width={320}
          value={query}
          placeholder="For example: Ivan Petrov"
          onChange={(e) => setQuery(e.target.value)}
        />
        <LoadingButton
          appearance="primary"
          isLoading={search.isSearching}
          isDisabled={query.trim().length < 2}
          onClick={submit}
        >
          Search
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
