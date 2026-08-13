import { useCallback, useState } from 'react';

/**
 * Общая механика «нашли кандидатов → отметили галочками → добавили батчем»
 * для поиска по имени и для поиска по ключу проекта.
 */
export const useCandidateSearch = ({ search, add }) => {
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [message, setMessage] = useState(null);

  const runSearch = useCallback(
    async (input, { preselectUntracked = false, trackedIds = new Set() } = {}) => {
      setIsSearching(true);
      setMessage(null);
      try {
        // Поиск по имени отдаёт массив, поиск по проекту — {users, warnings}.
        const result = await search(input);
        const found = Array.isArray(result) ? result : result?.users ?? [];
        const warnings = Array.isArray(result) ? [] : result?.warnings ?? [];

        setCandidates(found);
        setSelected(
          preselectUntracked
            ? new Set(found.filter((c) => !trackedIds.has(c.accountId)).map((c) => c.accountId))
            : new Set()
        );

        if (found.length === 0) {
          setMessage({
            appearance: 'warning',
            text: ['Nothing found', ...warnings].join(' '),
          });
        } else if (warnings.length > 0) {
          setMessage({ appearance: 'warning', text: warnings.join(' ') });
        }
      } catch (e) {
        setCandidates(null);
        setMessage({ appearance: 'error', text: e.message });
      } finally {
        setIsSearching(false);
      }
    },
    [search]
  );

  const toggle = useCallback((accountId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    (trackedIds) => {
      setSelected(
        new Set((candidates ?? []).filter((c) => !trackedIds.has(c.accountId)).map((c) => c.accountId))
      );
    },
    [candidates]
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const addSelected = useCallback(async () => {
    const chosen = (candidates ?? []).filter((c) => selected.has(c.accountId));
    if (chosen.length === 0) return;
    setIsAdding(true);
    setMessage(null);
    try {
      const result = await add(chosen);
      setSelected(new Set());
      setMessage({
        appearance: 'success',
        text: `Added: ${result.added}${result.skipped > 0 ? `, already tracked: ${result.skipped}` : ''}`,
      });
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setIsAdding(false);
    }
  }, [add, candidates, selected]);

  return {
    candidates,
    selected,
    isSearching,
    isAdding,
    message,
    runSearch,
    toggle,
    selectAll,
    clearSelection,
    addSelected,
  };
};
