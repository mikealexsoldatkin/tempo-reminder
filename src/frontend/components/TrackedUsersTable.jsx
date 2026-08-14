import React from 'react';
import { InlineEdit, Text, Textfield } from '@forge/react';
import { api } from '../api';
import { PeopleTable } from './PeopleTable';
import { ManagersCell } from './ManagersCell';

/**
 * Как человек назван в календаре отпусков — заполняется только если там его пишут
 * не так, как в Jira. Пустая ячейка означает «искать по displayName»; несколько
 * написаний перечисляются через запятую.
 *
 * Компонент без хуков, как и остальные ячейки этой таблицы.
 */
const CalendarNameCell = ({ user, onConfirm }) => (
  <InlineEdit
    defaultValue={user.calendarName ?? ''}
    editView={(fieldProps) => <Textfield {...fieldProps} placeholder="Name in the calendar" />}
    readView={() => <Text>{user.calendarName ?? '— same as in Jira'}</Text>}
    onConfirm={onConfirm}
  />
);

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
    extraColumns={[
      {
        key: 'managers',
        header: 'Managers',
        renderCell: (user) => (
          <ManagersCell
            person={user}
            managers={managers}
            onConfirm={async (managerIds) =>
              onUsersChange(
                await api.setTrackedUserManagers(user.accountId, managerIds ?? []).then((r) => r.users)
              )
            }
          />
        ),
      },
      {
        key: 'calendarName',
        header: 'Name in the vacation calendar',
        renderCell: (user) => (
          <CalendarNameCell
            user={user}
            onConfirm={async (calendarName) =>
              onUsersChange(
                await api.setTrackedUserCalendarName(user.accountId, calendarName).then((r) => r.users)
              )
            }
          />
        ),
      },
    ]}
  />
);
