import React from 'react';
import { Box, Checkbox, DynamicTable, Inline, Lozenge, Text } from '@forge/react';

/**
 * Таблица результатов поиска с чекбоксами — общая для поиска по имени и по проекту.
 * Показывает, в каких списках человек уже есть: отмеченного можно поставить под
 * наблюдение, назначить менеджером — или и то, и другое.
 */
export const CandidateTable = ({
  candidates,
  selected,
  onToggle,
  trackedIds,
  managerIds,
  showRoles = false,
}) => {
  const head = {
    cells: [
      { key: 'select', content: '', width: 5 },
      { key: 'name', content: 'Name', isSortable: true },
      { key: 'email', content: 'Email', isSortable: true },
      ...(showRoles ? [{ key: 'roles', content: 'Project roles', isSortable: true }] : []),
      // Сортировка по «уже есть в списке» — способ отделить новых от знакомых,
      // когда проект отдал полсотни человек, из которых половина заведена.
      { key: 'status', content: 'Tracked', isSortable: true },
      { key: 'manager', content: 'Manager', isSortable: true },
    ],
  };

  const rows = candidates.map((candidate) => {
    const isTracked = trackedIds.has(candidate.accountId);
    const isManager = managerIds.has(candidate.accountId);
    return {
      key: candidate.accountId,
      cells: [
        {
          key: 'select',
          content: (
            <Checkbox
              isChecked={selected.has(candidate.accountId)}
              onChange={() => onToggle(candidate.accountId)}
              label=""
            />
          ),
        },
        // Ключ сортируемой ячейки — это значение, по которому таблица сортирует:
        // элементы UI Kit ей сравнивать нечем.
        { key: candidate.displayName, content: <Text>{candidate.displayName}</Text> },
        { key: candidate.email ?? '', content: <Text>{candidate.email ?? '— no email'}</Text> },
        ...(showRoles
          ? [
              {
                key: candidate.roles?.join(', ') || '',
                content: <Text>{candidate.roles?.join(', ') || '—'}</Text>,
              },
            ]
          : []),
        {
          key: isTracked ? 'tracked' : 'not tracked',
          content: (
            <Lozenge appearance={isTracked ? 'success' : 'default'}>
              {isTracked ? 'tracked' : 'not tracked'}
            </Lozenge>
          ),
        },
        {
          key: isManager ? 'manager' : '—',
          content: (
            <Lozenge appearance={isManager ? 'success' : 'default'}>
              {isManager ? 'manager' : '—'}
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
      <DynamicTable
        head={head}
        rows={rows}
        rowsPerPage={10}
        isFixedSize
        defaultSortKey="name"
        defaultSortOrder="ASC"
      />
    </Box>
  );
};
