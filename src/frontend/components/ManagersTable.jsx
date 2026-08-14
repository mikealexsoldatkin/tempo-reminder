import React from 'react';
import { api } from '../api';
import { PeopleTable } from './PeopleTable';

/**
 * Менеджеры: получатели дайджестов «не отчитался» и детальных разборов по дням.
 *
 * Список независим от отслеживаемых сотрудников — менеджер не обязан сам быть
 * под наблюдением. Таблица стоит выше Tracked users намеренно: колонки менеджеров
 * там выбирают из этого списка, и заполнять его надо первым.
 *
 * Удаление менеджера снимает его с сотрудников в обоих наборах получателей,
 * поэтому ответ приносит оба обновлённых списка.
 */
export const ManagersTable = ({ managers, onManagersChange, onUsersChange }) => (
  <PeopleTable
    title="Managers"
    people={managers}
    emptyMessage="No managers yet — nobody will get the digests or the detailed reports. Add people with “Mark as a manager” in the sections above."
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
