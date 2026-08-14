import React from 'react';
import { CheckboxGroup, InlineEdit, Text } from '@forge/react';
import { api } from '../api';
import { PeopleTable } from './PeopleTable';

/**
 * Редактор менеджеров одного сотрудника.
 *
 * У Select в UI Kit нет компонента Option — options ему передать нечем
 * (@forge/react 12.1.1 экспортирует только сам 'Select'). Поэтому множественный
 * выбор собран на CheckboxGroup: клик по ячейке раскрывает список менеджеров
 * с галочками, отмечаем нужных и подтверждаем — сохранение как у остальных
 * инлайн-полей.
 *
 * Список галочек CheckboxGroup задаётся только массивом options: дочерние
 * <Checkbox> он не читает, а рендерер безусловно делает options.map() — без пропа
 * ячейка падает с «undefined is not an object (evaluating 'a.map')».
 * Отмеченные значения тоже приходят из группы (defaultValue), не с отдельных
 * галочек.
 *
 * Компонент без хуков намеренно: его вызывает DynamicTable прямо в своём рендере,
 * см. комментарий к EmailCell в PeopleTable.jsx.
 */
const ManagersCell = ({ user, managers, onConfirm }) => {
  const assigned = new Set(user.managerIds ?? []);
  const names = managers.filter((m) => assigned.has(m.accountId)).map((m) => m.displayName);

  if (managers.length === 0) {
    return <Text>— add someone to Managers first</Text>;
  }

  return (
    <InlineEdit
      defaultValue={[...assigned]}
      editView={(fieldProps) => (
        <CheckboxGroup
          name={`managers-${user.accountId}`}
          defaultValue={[...assigned]}
          options={managers.map((manager) => ({
            value: manager.accountId,
            label: manager.displayName,
          }))}
          onChange={fieldProps.onChange}
        />
      )}
      readView={() => <Text>{names.length > 0 ? names.join(', ') : '— none'}</Text>}
      onConfirm={onConfirm}
    />
  );
};

/**
 * Отслеживаемые сотрудники: те, кого приложение проверяет в Tempo. Колонка Managers
 * связывает сотрудника с людьми из таблицы Managers — именно им уйдёт дайджест,
 * если сотрудник не отчитался. По умолчанию связь пуста и заполняется вручную.
 */
export const TrackedUsersTable = ({ users, managers, onUsersChange }) => (
  <PeopleTable
    title="Tracked users"
    people={users}
    emptyMessage="The list is empty — no reminders will be sent. Add users by searching for a name or by project key."
    onRemove={async (accountIds) => onUsersChange(await api.removeTrackedUsers(accountIds).then((r) => r.users))}
    onSetEmail={async (accountId, email) =>
      onUsersChange(await api.setTrackedUserEmail(accountId, email).then((r) => r.users))
    }
    extraColumn={{
      key: 'managers',
      header: 'Managers',
      renderCell: (user) => (
        <ManagersCell
          user={user}
          managers={managers}
          onConfirm={async (managerIds) =>
            onUsersChange(
              await api.setTrackedUserManagers(user.accountId, managerIds ?? []).then((r) => r.users)
            )
          }
        />
      ),
    }}
  />
);
