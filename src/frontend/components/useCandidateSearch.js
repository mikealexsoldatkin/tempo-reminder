import { useCallback, useState } from 'react';

/**
 * Общая механика «нашли кандидатов → отметили галочками → отправили батчем»
 * для поиска по имени и по ключу проекта.
 *
 * Действий над выделенным может быть несколько (добавить в отслеживаемые,
 * назначить менеджером), поэтому они передаются словарём и различаются ключом.
 * Каждое действие само возвращает текст об успехе — формулировки у них разные.
 *
 * @param {{ search: (input: string) => Promise<any>,
 *           actions: Record<string, (chosen: Array) => Promise<string>> }} config
 */
export const useCandidateSearch = ({ search, actions }) => {
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
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

  // Без исключений: действий над выделенным теперь два, и «уже отслеживаемый»
  // ничего не говорит о том, годится ли человек в менеджеры. Повторное добавление
  // безопасно — бэкенд считает такие записи пропущенными.
  const selectAll = useCallback(() => {
    setSelected(new Set((candidates ?? []).map((c) => c.accountId)));
  }, [candidates]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const submitSelected = useCallback(
    async (actionKey) => {
      const chosen = (candidates ?? []).filter((c) => selected.has(c.accountId));
      if (chosen.length === 0) return;

      setBusyAction(actionKey);
      setMessage(null);
      try {
        const text = await actions[actionKey](chosen);
        // Выделение намеренно остаётся: один человек может быть и отслеживаемым,
        // и менеджером, а сброс заставлял бы отмечать его заново ради второго
        // действия. Что действие уже применено, видно по лозенгам в таблице.
        setMessage({ appearance: 'success', text });
      } catch (e) {
        setMessage({ appearance: 'error', text: e.message });
      } finally {
        setBusyAction(null);
      }
    },
    [actions, candidates, selected]
  );

  return {
    candidates,
    selected,
    isSearching,
    busyAction,
    message,
    runSearch,
    toggle,
    selectAll,
    clearSelection,
    submitSelected,
  };
};
