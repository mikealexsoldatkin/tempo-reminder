import React from 'react';
import { api } from '../api';
import { PeopleTable } from './PeopleTable';

/**
 * Менеджеры: получатели дайджеста со списком не отчитавшихся подчинённых и детальных
 * отчётов по тем, за кем следят глубоко.
 *
 * Список независим от отслеживаемых сотрудников — менеджер не обязан сам быть
 * под наблюдением. Удаление менеджера снимает его со всех подчинённых в обоих
 * списках, поэтому ответ приносит все три обновлённых списка.
 */
export const ManagersTable = ({
  managers,
  onManagersChange,
  onUsersChange,
  onDetailedUsersChange,
}) => (
  <PeopleTable
    title="Managers"
    people={managers}
    emptyMessage="No managers yet — nobody will get the digest. Add people with “Mark as a manager” in the sections above."
    onRemove={async (accountIds) => {
      const result = await api.removeManagers(accountIds);
      onManagersChange(result.managers);
      onUsersChange(result.users);
      onDetailedUsersChange(result.detailedUsers);
    }}
    onSetEmail={async (accountId, email) =>
      onManagersChange(await api.setManagerEmail(accountId, email).then((r) => r.managers))
    }
  />
);
