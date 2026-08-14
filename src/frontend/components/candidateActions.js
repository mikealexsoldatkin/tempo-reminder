// С расширением: package.json объявляет "type": "module", поэтому .js-файлы
// резолвятся как строгий ESM и путь без .js не находится (в .jsx это не так).
import { api } from '../api.js';

/**
 * Что можно сделать с отмеченными кандидатами. Обе секции поиска предлагают одно
 * и то же, поэтому действия описаны один раз здесь.
 *
 * Каждое действие возвращает текст об успехе: формулировки у списков разные,
 * а сам хук поиска про их смысл ничего не знает.
 */
export const candidateActions = ({ onUsersChange, onManagersChange }) => ({
  track: async (chosen) => {
    const result = await api.addTrackedUsers(chosen);
    onUsersChange(result.users);
    return `Now tracked: ${result.added}${result.skipped > 0 ? `, already tracked: ${result.skipped}` : ''}`;
  },

  manager: async (chosen) => {
    const result = await api.addManagers(chosen);
    onManagersChange(result.managers);
    return `Marked as managers: ${result.added}${result.skipped > 0 ? `, already managers: ${result.skipped}` : ''}`;
  },
});
