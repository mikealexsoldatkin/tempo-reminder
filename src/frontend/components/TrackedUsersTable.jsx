import React from 'react';
import { HelperMessage, InlineEdit, Stack, Text, Textfield } from '@forge/react';
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
 * Отслеживаемые сотрудники — единственный список людей, за которыми следит
 * приложение. Быть в нём значит «проверяем в Tempo и пишем лично, если время не
 * залогировано».
 *
 * Кому уходят сообщения о человеке, задают две независимые колонки менеджеров:
 *  - basic report — дайджест «не отчитался», списком пропущенных дней;
 *  - detailed report — разбор worklog'ов день за днём, задачами и описаниями.
 * Наборы не связаны: можно заполнить любой, оба или ни одного — на личное
 * напоминание самому сотруднику это не влияет.
 */
export const TrackedUsersTable = ({ users, managers, onUsersChange }) => (
  <Stack space="space.100">
    <PeopleTable
      title="Tracked users"
      people={users}
      emptyMessage="The list is empty — no reminders will be sent. Add users by searching for a name or by project key."
      onRemove={async (accountIds) =>
        onUsersChange(await api.removeTrackedUsers(accountIds).then((r) => r.users))
      }
      onSetEmail={async (accountId, email) =>
        onUsersChange(await api.setTrackedUserEmail(accountId, email).then((r) => r.users))
      }
      extraColumns={[
        {
          key: 'calendarName',
          header: 'Name in the vacation calendar',
          renderCell: (user, mutate) => (
            <CalendarNameCell
              user={user}
              onConfirm={(calendarName) =>
                mutate(async () =>
                  onUsersChange(
                    await api
                      .setTrackedUserCalendarName(user.accountId, calendarName)
                      .then((r) => r.users)
                  )
                )
              }
            />
          ),
        },
        {
          key: 'managers',
          header: 'Managers who get the basic report',
          renderCell: (user, mutate) => (
            <ManagersCell
              person={user}
              assignedIds={user.managerIds}
              managers={managers}
              field="basic"
              emptyLabel="— nobody is told about them"
              onConfirm={(managerIds) =>
                mutate(async () =>
                  onUsersChange(
                    await api
                      .setTrackedUserManagers(user.accountId, managerIds ?? [])
                      .then((r) => r.users)
                  )
                )
              }
            />
          ),
        },
        {
          key: 'detailedManagers',
          header: 'Managers who get the detailed report',
          renderCell: (user, mutate) => (
            <ManagersCell
              person={user}
              assignedIds={user.detailedManagerIds}
              managers={managers}
              field="detailed"
              emptyLabel="— no detailed report"
              onConfirm={(managerIds) =>
                mutate(async () =>
                  onUsersChange(
                    await api
                      .setTrackedUserDetailedManagers(user.accountId, managerIds ?? [])
                      .then((r) => r.users)
                  )
                )
              }
            />
          ),
        },
      ]}
    />
    <HelperMessage>
      Click a Managers cell to pick who hears about this person. The basic report is the digest
      “hasn’t logged time”, sent on the “Manager run times” schedule. The detailed report is the
      day-by-day breakdown of what they logged — one message per person, same schedule, weekdays
      only. Everyone in this table gets a personal reminder regardless of both columns.
    </HelperMessage>
    {users.length > 0 && managers.length === 0 && (
      <Text>Add someone to Managers above — there is nobody to send reports to yet.</Text>
    )}
  </Stack>
);
