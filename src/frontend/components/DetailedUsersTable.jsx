import React from 'react';
import { HelperMessage, Stack, Text } from '@forge/react';
import { api } from '../api';
import { PeopleTable } from './PeopleTable';
import { ManagersCell } from './ManagersCell';

/**
 * Детально отслеживаемые: те, по кому менеджеру уходит не «отчитался / не отчитался»,
 * а разбор дня за днём — какие задачи, с каким типом работы и с каким описанием.
 *
 * Список независим от Tracked users: человек может быть в обоих, только здесь или
 * только там. Email и Slack в таблице не показываются — сообщение получает менеджер
 * из колонки справа, а не сам сотрудник; от него нужен только accountId для Tempo.
 */
export const DetailedUsersTable = ({ users, managers, onDetailedUsersChange }) => (
  <Stack space="space.100">
    <PeopleTable
      title="Detailed tracking users"
      people={users}
      showContact={false}
      emptyMessage="The list is empty — no detailed reports will be sent. Add people with “Track in detail” in the sections above."
      onRemove={async (accountIds) =>
        onDetailedUsersChange(await api.removeDetailedUsers(accountIds).then((r) => r.detailedUsers))
      }
      extraColumns={[
        {
          key: 'managers',
          header: 'Managers who get the report',
          renderCell: (user) => (
            <ManagersCell
              person={user}
              managers={managers}
              emptyLabel="— nobody gets this report"
              onConfirm={async (managerIds) =>
                onDetailedUsersChange(
                  await api
                    .setDetailedUserManagers(user.accountId, managerIds ?? [])
                    .then((r) => r.detailedUsers)
                )
              }
            />
          ),
        },
      ]}
    />
    <HelperMessage>
      One message per person, sent on the “Manager run times” schedule and on weekdays only. It
      covers the whole window — “Working days to check” — and ignores the acceptable delay: only
      weekends, holidays and the vacation calendar excuse an empty day, and the reason is printed
      under the date.
    </HelperMessage>
    {users.length > 0 && managers.length === 0 && (
      <Text>Add someone to Managers below — there is nobody to send these reports to yet.</Text>
    )}
  </Stack>
);
