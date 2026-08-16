import React, { useState } from 'react';
import {
  Form,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';
import { CandidateResults } from './CandidateResults';
import { useCandidateSearch } from './useCandidateSearch';
import { candidateActions } from './candidateActions';

/**
 * Поиск пользователей Jira по First + Last name (Jira ищет и по email) и батчевое
 * добавление — в отслеживаемые или в менеджеры.
 *
 * Куда именно, решает не пользователь внутри окна, а кнопка, которой окно открыли:
 * `action` — 'track' или 'manager'. Один и тот же человек по-прежнему может быть
 * и там, и там — просто добавляют его двумя заходами, от своей таблицы.
 *
 * Заголовка у секции нет намеренно: она живёт в модальном окне (см.
 * AddPeopleActions), и название ей даёт ModalTitle.
 */
export const AddByNameSection = ({
  action,
  trackedIds,
  managerIds,
  onUsersChange,
  onManagersChange,
}) => {
  const [query, setQuery] = useState('');
  const search = useCandidateSearch({
    search: (value) => api.searchUsersByName(value),
    actions: candidateActions({ onUsersChange, onManagersChange }),
  });

  // Jira ищет по подстроке, и с одного символа ответ — это половина инстанса,
  // поэтому нижняя граница есть; Enter при коротком запросе просто ничего не делает.
  const isTooShort = query.trim().length < 2;
  const submit = () => {
    if (isTooShort || search.isSearching) return;
    search.runSearch(query);
  };

  return (
    <Stack space="space.150">
      <Text>
        Enter a first and last name (or part of one) — Jira searches by display name and email. Tick
        the people you need and add them{' '}
        {action === 'manager' ? 'to the managers.' : 'to the tracked users.'}
      </Text>

      {/* Форма, а не просто поле с кнопкой: Textfield в UI Kit не принимает
          onKeyDown, и единственный способ отдать Enter поиску — submit настоящей
          формы с кнопкой type="submit". */}
      <Form onSubmit={submit}>
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
            type="submit"
            isLoading={search.isSearching}
            isDisabled={isTooShort}
          >
            Search
          </LoadingButton>
        </Inline>
      </Form>
      <HelperMessage>
        {isTooShort
          ? 'Type at least two characters, then press Enter or click Search.'
          : 'Press Enter to search.'}
      </HelperMessage>

      <CandidateResults
        search={search}
        action={action}
        trackedIds={trackedIds}
        managerIds={managerIds}
      />
    </Stack>
  );
};
