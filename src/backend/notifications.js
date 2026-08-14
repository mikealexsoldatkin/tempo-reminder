/**
 * Что именно уходит в Slack: группировка не отчитавшихся по менеджерам и сборка
 * текстов из шаблонов. Модуль намеренно без KVS и сети — чистые функции под тестами.
 */

/**
 * Не отчитавшиеся, разложенные по менеджерам.
 *
 * Связь задаётся полем managerIds у отслеживаемого пользователя и по умолчанию пуста:
 * пока менеджер не назначен вручную, о человеке не узнает никто. Менеджеры без
 * единого не отчитавшегося подчинённого в результат не попадают — им нечего слать.
 *
 * @param {Array} unreportedUsers отслеживаемые, у кого нет записей в Tempo за окно
 * @param {Array} managers полный список менеджеров
 * @returns {Array<{manager: object, people: Array}>} в порядке списка менеджеров
 */
export function groupByManager(unreportedUsers, managers) {
  const peopleByManager = new Map();

  for (const user of unreportedUsers) {
    for (const managerId of user.managerIds ?? []) {
      if (!peopleByManager.has(managerId)) peopleByManager.set(managerId, []);
      peopleByManager.get(managerId).push(user);
    }
  }

  return managers
    .map((manager) => ({ manager, people: peopleByManager.get(manager.accountId) ?? [] }))
    .filter(({ people }) => people.length > 0);
}

/**
 * Сколько отслеживаемых остались вообще без менеджера — такие ни в один дайджест
 * не попадут, и об этом честнее сказать в отчёте, чем молча их потерять.
 */
export function countWithoutManager(unreportedUsers) {
  return unreportedUsers.filter((user) => (user.managerIds ?? []).length === 0).length;
}

export function renderUserMessage(template, { user, window, lookbackWorkingDays }) {
  return fillPlaceholders(template, {
    name: firstName(user.displayName),
    from: window.from,
    to: window.to,
    days: String(lookbackWorkingDays),
  });
}

export function renderManagerMessage(template, { manager, people, window, lookbackWorkingDays }) {
  return fillPlaceholders(template, {
    name: firstName(manager.displayName),
    from: window.from,
    to: window.to,
    days: String(lookbackWorkingDays),
    count: String(people.length),
    list: people.map((person) => `• ${person.displayName}`).join('\n'),
  });
}

/**
 * Подстановка за один проход: последовательные replaceAll подставили бы плейсхолдер,
 * пришедший из данных (например, имя вида «{days}»), на следующем шаге.
 */
function fillPlaceholders(template, values) {
  return String(template).replace(/\{(name|from|to|days|count|list)}/g, (match, key) =>
    values[key] ?? match
  );
}

function firstName(displayName) {
  return String(displayName ?? '').split(' ')[0];
}
