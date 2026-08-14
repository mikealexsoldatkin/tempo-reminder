/**
 * Отпуска: сопоставление событий корпоративного календаря с отслеживаемыми людьми
 * и вычёркивание отпускных дней из пропущенных.
 *
 * Календарь отпусков — это события на весь день, в заголовке которых стоит имя
 * сотрудника: `[vacation] Aleksandr Bugrov`. Тип отпуска (тег в начале) значения
 * не имеет: в этом календаре любое событие означает, что человека нет на работе.
 *
 * Модуль без сети и без KVS — чистые функции под тестами. Загрузка фида живёт
 * в vacationCalendar.js.
 */

import { eventDays } from './ics.js';

/**
 * Отпускные дни каждого человека в пределах окна.
 *
 * Совпадение — имя человека подстрокой заголовка, но по границам слов: иначе
 * «Ann Lee» нашлась бы внутри «Joann Leeson». Регистр, диакритика и пунктуация
 * при сравнении не учитываются, поэтому `[VACATION] Renée O'Brien` матчится с
 * «Renee OBrien» из Jira.
 *
 * @param {Array} events события из parseIcs
 * @param {Array} people отслеживаемые (нужны accountId, displayName, calendarName)
 * @param {{from: string, to: string}} range окно, обе границы включительно
 * @returns {{
 *   daysByPerson: Map<string, Set<string>>,
 *   matchedEvents: number,
 *   unmatched: Array<{title: string, count: number}>,
 *   recurringSkipped: number,
 *   timedSkipped: number
 * }}
 */
export function collectVacationDays(events, people, range) {
  const index = indexPeople(people);
  const daysByPerson = new Map();
  const unmatched = new Map();
  let matchedEvents = 0;
  let recurringSkipped = 0;
  let timedSkipped = 0;

  for (const event of events ?? []) {
    // События со временем — не отпуск: отпуск заводят на весь день.
    if (!event.allDay) {
      timedSkipped++;
      continue;
    }
    const days = eventDays(event, range);
    if (days.length === 0) continue;

    // Повторяющиеся события в календаре отпусков не встречаются, и разворачивать
    // RRULE ради них незачем. Но пропустить их молча нельзя: если такое событие
    // всё-таки появится, человек получит напоминание за дни своего отсутствия,
    // поэтому они попадают в счётчик и оттуда в отчёт.
    if (event.recurring) {
      recurringSkipped++;
      continue;
    }

    const matches = matchPeople(event.summary, index);
    if (matches.length === 0) {
      const seen = unmatched.get(event.summary);
      if (seen) seen.count++;
      else unmatched.set(event.summary, { title: event.summary, count: 1 });
      continue;
    }

    matchedEvents++;
    for (const accountId of matches) {
      if (!daysByPerson.has(accountId)) daysByPerson.set(accountId, new Set());
      for (const day of days) daysByPerson.get(accountId).add(day);
    }
  }

  return {
    daysByPerson,
    matchedEvents,
    unmatched: [...unmatched.values()].sort((a, b) => b.count - a.count),
    recurringSkipped,
    timedSkipped,
  };
}

/**
 * Кого упоминает заголовок события. Возвращает accountId — событие может назвать
 * и нескольких людей («[vacation] Ann Lee, Bob Ray»), поэтому список, а не один.
 *
 * @param {string} summary
 * @param {Array<{accountId: string, names: string[]}>} index результат indexPeople
 */
export function matchPeople(summary, index) {
  const haystack = ` ${normalize(summary)} `;
  const matched = [];
  for (const { accountId, names } of index) {
    if (names.some((name) => haystack.includes(` ${name} `))) matched.push(accountId);
  }
  return matched;
}

/**
 * Имена, по которым ищем человека в заголовках: обычно это displayName из Jira,
 * но если в календаре его пишут иначе (никнейм, другой порядок, кириллица), в
 * настройках можно задать свои варианты через запятую.
 */
export function indexPeople(people) {
  return (people ?? [])
    .map((person) => ({
      accountId: person.accountId,
      names: personNames(person),
    }))
    .filter(({ names }) => names.length > 0);
}

function personNames(person) {
  const override = String(person.calendarName ?? '').trim();
  const source = override ? override.split(',') : [person.displayName ?? ''];
  return [...new Set(source.map(normalize).filter((name) => name.length > 0))];
}

/**
 * Приведение к сравнимому виду: нижний регистр, снятие диакритики, любая
 * пунктуация и эмодзи — в пробел. Так `[vacation] Aleksandr Bugrov 🌴` и
 * `Vacation: aleksandr bugrov` дают одну и ту же строку токенов.
 *
 * Апостроф — исключение: он выбрасывается, а не превращается в пробел. Иначе
 * `O’Brien` и `OBrien` (Jira и календарь пишут такие фамилии по-разному) дали бы
 * разное число токенов и не сошлись бы. Дефис, наоборот, разделитель: `Anne-Marie`
 * и `Anne Marie` — одно и то же имя.
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Вычёркивание отпускных дней из пропущенных.
 *
 * Логика подневная, а не «человек в отпуске — пропускаем целиком»: вернувшийся из
 * двухнедельного отпуска не должен получить претензию за дни своего отсутствия, но
 * за уже отработанные дни окна — должен.
 *
 * @param {Map<string, string[]>} missingDaysByUser
 * @param {Map<string, Set<string>>} daysByPerson
 * @returns {{ missingDaysByUser: Map<string, string[]>, excusedDaysByUser: Map<string, string[]> }}
 */
export function excludeVacationDays(missingDaysByUser, daysByPerson) {
  const missing = new Map();
  const excused = new Map();

  for (const [accountId, days] of missingDaysByUser) {
    const vacation = daysByPerson.get(accountId);
    if (!vacation || vacation.size === 0) {
      missing.set(accountId, days);
      excused.set(accountId, []);
      continue;
    }
    missing.set(accountId, days.filter((day) => !vacation.has(day)));
    excused.set(accountId, days.filter((day) => vacation.has(day)));
  }

  return { missingDaysByUser: missing, excusedDaysByUser: excused };
}
