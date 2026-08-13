import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  Heading,
  Inline,
  InlineEdit,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';

/**
 * Текущий список отслеживаемых пользователей: удаление (по одному и батчем)
 * и ручная правка email — он нужен для поиска человека в Slack, а Jira
 * отдаёт его только если профиль не скрыт настройками приватности.
 */
export const TrackedUsersTable = ({ users, onUsersChange }) => {
  const [selected, setSelected] = useState(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (accountId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const mutate = async (action) => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await action();
      onUsersChange(result.users);
      setSelected(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const head = {
    cells: [
      { key: 'select', content: '', width: 5 },
      { key: 'name', content: 'Name' },
      { key: 'email', content: 'Email for Slack lookup' },
      { key: 'slack', content: 'Slack' },
      { key: 'actions', content: '', width: 10 },
    ],
  };

  const rows = users.map((user) => ({
    key: user.accountId,
    cells: [
      {
        key: 'select',
        content: (
          <Checkbox isChecked={selected.has(user.accountId)} onChange={() => toggle(user.accountId)} label="" />
        ),
      },
      { key: 'name', content: <Text>{user.displayName}</Text> },
      {
        key: 'email',
        content: (
          <InlineEdit
            defaultValue={user.email ?? ''}
            editView={(fieldProps) => <Textfield {...fieldProps} placeholder="name@company.com" />}
            // Тип элемента не зависит от данных: иначе строка перерисовывается
            // с другой структурой, когда у пользователя появляется email.
            readView={() => <Text>{user.email ?? '— set an email'}</Text>}
            onConfirm={(value) => mutate(() => api.setTrackedUserEmail(user.accountId, value))}
          />
        ),
      },
      {
        key: 'slack',
        content: (
          <Lozenge appearance={user.slackUserId ? 'success' : 'default'}>
            {user.slackUserId ? 'found' : '—'}
          </Lozenge>
        ),
      },
      {
        key: 'actions',
        content: (
          <Button
            appearance="subtle"
            iconBefore="trash"
            isDisabled={isBusy}
            onClick={() => mutate(() => api.removeTrackedUsers([user.accountId]))}
          >
            Remove
          </Button>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">Tracked users ({users.length})</Heading>

      {/* Два независимых блока, а не тернар: при удалении последнего пользователя
          на одной позиции не подменяется тип элемента. */}
      {users.length === 0 && (
        <SectionMessage appearance="warning">
          <Text>
            The list is empty — no reminders will be sent. Add users by searching for a name or by
            project key.
          </Text>
        </SectionMessage>
      )}

      {users.length > 0 && (
        <Box>
          <DynamicTable head={head} rows={rows} rowsPerPage={20} isLoading={isBusy} />
        </Box>
      )}

      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {users.length > 0 && (
        <Inline space="space.100">
          <LoadingButton
            appearance="danger"
            isLoading={isBusy}
            isDisabled={selected.size === 0}
            onClick={() => mutate(() => api.removeTrackedUsers([...selected]))}
          >
            Remove selected ({selected.size})
          </LoadingButton>
          <Button appearance="subtle" isDisabled={selected.size === 0} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </Inline>
      )}
    </Stack>
  );
};
