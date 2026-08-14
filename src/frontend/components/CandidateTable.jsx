import React from 'react';
import { Box, Checkbox, DynamicTable, Inline, Lozenge, Text } from '@forge/react';

/**
 * Таблица результатов поиска с чекбоксами — общая для поиска по имени и по проекту.
 */
export const CandidateTable = ({ candidates, selected, onToggle, trackedIds, showRoles = false }) => {
  const head = {
    cells: [
      { key: 'select', content: '', width: 5 },
      { key: 'name', content: 'Name' },
      { key: 'email', content: 'Email' },
      ...(showRoles ? [{ key: 'roles', content: 'Project roles' }] : []),
      { key: 'status', content: 'Status' },
    ],
  };

  const rows = candidates.map((candidate) => {
    const isTracked = trackedIds.has(candidate.accountId);
    return {
      key: candidate.accountId,
      cells: [
        {
          key: 'select',
          content: (
            <Checkbox
              isChecked={selected.has(candidate.accountId)}
              isDisabled={isTracked}
              onChange={() => onToggle(candidate.accountId)}
              label=""
            />
          ),
        },
        { key: 'name', content: <Text>{candidate.displayName}</Text> },
        { key: 'email', content: <Text>{candidate.email ?? '— no email'}</Text> },
        ...(showRoles
          ? [{ key: 'roles', content: <Text>{candidate.roles?.join(', ') || '—'}</Text> }]
          : []),
        {
          key: 'status',
          content: (
            <Lozenge appearance={isTracked ? 'success' : 'default'}>
              {isTracked ? 'already tracked' : 'not tracked'}
            </Lozenge>
          ),
        },
      ],
    };
  });

  return (
    <Box>
      <Inline space="space.100" alignBlock="center">
        <Text>
          Found: {candidates.length}, selected: {selected.size}
        </Text>
      </Inline>
      <DynamicTable head={head} rows={rows} rowsPerPage={10} isFixedSize />
    </Box>
  );
};
