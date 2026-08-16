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
 * Пакетное добавление по ключу проекта — аналог прежнего getProjectPeople():
 * подтягиваем всех, кого можно назначить на задачи проекта, и добавляем батчем.
 *
 * Действие здесь только одно, «под наблюдение»: окно открывается из таблицы
 * Tracked users, и целым проектом менеджеров не назначают — их отмечают поштучно
 * поиском по имени.
 *
 * Заголовка у секции нет намеренно: она живёт в модальном окне (см.
 * AddPeopleActions), и название ей даёт ModalTitle.
 */
export const AddByProjectSection = ({ trackedIds, managerIds, onUsersChange, onManagersChange }) => {
  const [projectKey, setProjectKey] = useState('');
  const search = useCandidateSearch({
    search: (value) => api.searchProjectMembers(value),
    actions: candidateActions({ onUsersChange, onManagersChange }),
  });

  const isEmpty = projectKey.trim().length === 0;
  const submit = () => {
    if (isEmpty || search.isSearching) return;
    search.runSearch(projectKey, { preselectUntracked: true, trackedIds });
  };

  return (
    <Stack space="space.150">
      <Text>
        Loads the people from the project’s own roles — the same list you see in Project settings →
        People. Instance-wide roles are ignored, and the result doesn’t depend on the permission
        scheme. Anyone not tracked yet is ticked automatically — clear the ones you don’t need.
      </Text>

      {/* Форма ради Enter: Textfield в UI Kit не принимает onKeyDown, так что
          клавиша доходит до поиска только через submit настоящей формы. */}
      <Form onSubmit={submit}>
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
            type="submit"
            isLoading={search.isSearching}
            isDisabled={isEmpty}
          >
            Load members
          </LoadingButton>
        </Inline>
      </Form>
      <HelperMessage>Press Enter to load the members.</HelperMessage>

      <CandidateResults
        search={search}
        action="track"
        trackedIds={trackedIds}
        managerIds={managerIds}
        showRoles
      />
    </Stack>
  );
};
