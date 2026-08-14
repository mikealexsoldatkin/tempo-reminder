import React from 'react';
import { api } from '../api';
import { PeopleTable } from './PeopleTable';

/**
 * Менеджеры: получатели дайджеста со списком не отчитавшихся подчинённых.
 *
 * Список независим от отслеживаемых сотрудников — менеджер не обязан сам быть
 * под наблюдением. Удаление менеджера снимает его и со всех подчинённых, поэтому
 * ответ приносит оба обновлённых списка.
 */
export const ManagersTable = ({ managers, onManagersChange, onUsersChange }) => (
  <PeopleTable
    title="Managers"
    people={managers}
    emptyMessage="No managers yet — nobody will get the digest. Add people with “Mark as a manager” in the sections above."
    onRemove={async (accountIds) => {
      const result = await api.removeManagers(accountIds);
      onManagersChange(result.managers);
      onUsersChange(result.users);
    }}
    onSetEmail={async (accountId, email) =>
      onManagersChange(await api.setManagerEmail(accountId, email).then((r) => r.managers))
    }
  />
);
