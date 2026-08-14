import React, { useState } from 'react';
import { Heading, Inline, Label, LoadingButton, Stack, Text, Textfield } from '@forge/react';
import { api } from '../api';
import { CandidateResults } from './CandidateResults';
import { useCandidateSearch } from './useCandidateSearch';
import { candidateActions } from './candidateActions';

/**
 * Поиск пользователей Jira по First + Last name (Jira ищет и по email) и батчевое
 * добавление — под наблюдение и/или в менеджеры.
 */
export const AddByNameSection = ({ trackedIds, managerIds, onUsersChange, onManagersChange }) => {
  const [query, setQuery] = useState('');
  const search = useCandidateSearch({
    search: (value) => api.searchUsersByName(value),
    actions: candidateActions({ onUsersChange, onManagersChange }),
  });

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">Search by name</Heading>
      <Text>
        Enter a first and last name (or part of one) — Jira searches by display name and email.
        Tick the people you need, then put them under tracking, mark them as managers, or both.
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
          onClick={() => search.runSearch(query)}
        >
          Search
        </LoadingButton>
      </Inline>

      <CandidateResults search={search} trackedIds={trackedIds} managerIds={managerIds} />
    </Stack>
  );
};
