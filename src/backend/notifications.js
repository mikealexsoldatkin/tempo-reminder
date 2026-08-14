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

/**
 * Размер команды каждого менеджера — по всем отслеживаемым, а не только по
 * должникам: в сообщении «все отчитались» счётчик означает именно команду.
 *
 * @param {Array} users все отслеживаемые пользователи
 * @returns {Map<string, number>} accountId менеджера → сколько за ним закреплено
 */
export function countManagedPeople(users) {
  const counts = new Map();
  for (const user of users) {
    for (const managerId of user.managerIds ?? []) {
      counts.set(managerId, (counts.get(managerId) ?? 0) + 1);
    }
  }
  return counts;
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
 * Сообщение менеджеру, у которого отчитались все. Списка должников тут нет,
 * поэтому {list} не подставляется и остаётся в тексте как есть — так виднее,
 * что плейсхолдер выбран не из того шаблона.
 */
export function renderManagerAllClearMessage(
  template,
  { manager, managedCount, window, lookbackWorkingDays }
) {
  return fillPlaceholders(template, {
    name: firstName(manager.displayName),
    from: window.from,
    to: window.to,
    days: String(lookbackWorkingDays),
    count: String(managedCount),
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
