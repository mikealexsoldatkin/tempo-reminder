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
export const ManagersTable = ({ managers, onManagersChange, onUsersChange, addActions }) => (
  <PeopleTable
    title="Managers"
    people={managers}
    addActions={addActions}
    removeWarning="They are also cleared from every tracked user who has them in the “basic report” or “detailed report” column, so those people lose that recipient. Nothing rebuilds those columns for you."
    emptyMessage="No managers yet — nobody will get the digests or the detailed reports. Add them with the “Add managers” button below."
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
