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
import { addDays } from './workdays.js';

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

/* --------------------------- память о событиях --------------------------- */

/**
 * Кэш событий календаря.
 *
 * Отпуск — величина, которую прогон пересчитывает заново из живого фида, и любой
 * его отказ раньше означал «отпусков нет»: человек, вернувшийся из отпуска,
 * получал претензию за дни своего отсутствия, а менеджер — его в дайджесте.
 * Поэтому прочитанные события запоминаются, и у прогона всегда есть чем
 * подстраховаться, если Google не ответил или отдал пустоту.
 *
 * Помним не «прощённые дни», а сами события: список отслеживаемых и окно проверки
 * меняются, и сопоставление имён должно считаться каждый раз заново — иначе
 * исправленное написание имени не подхватилось бы для уже прошедших отпусков.
 */

/**
 * Сколько прошедших событий держим. Окно проверки ограничено 30 рабочими днями
 * (≈ 6 недель), так что 120 календарных дней покрывают его с запасом, а кэш при
 * этом не растёт бесконечно.
 */
export const VACATION_CACHE_DAYS = 120;

// Предохранитель по размеру: значение в KVS ограничено, а на четыре поля события
// это тысячи отпусков — больше, чем бывает у компании за полгода.
const MAX_CACHED_EVENTS = 2000;

/**
 * Что из прочитанного вообще имеет смысл запоминать: только события на весь день
 * и только неповторяющиеся — остальные в отпуска всё равно не попадают. Хранимая
 * форма урезана до четырёх полей: ключ, заголовок и границы.
 */
export function cacheableEvents(events) {
  const seen = new Set();
  const stored = [];
  for (const event of events ?? []) {
    if (!event?.allDay || event.recurring || !event.start) continue;
    const entry = {
      uid: event.uid ?? null,
      summary: event.summary ?? '',
      start: event.start,
      end: event.end ?? addDays(event.start, 1),
    };
    const key = eventKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    stored.push(entry);
  }
  return stored;
}

/** Обратно в форму события: всё запомненное по построению на весь день и без RRULE. */
export function restoreEvents(stored) {
  return (stored ?? [])
    .filter((entry) => entry?.start && entry?.end)
    .map((entry) => ({
      uid: entry.uid ?? null,
      summary: entry.summary ?? '',
      start: entry.start,
      end: entry.end,
      allDay: true,
      recurring: false,
    }));
}

/** Забываем то, что закончилось раньше горизонта: такие дни уже вне любого окна. */
export function pruneVacationEvents(stored, today, keepDays = VACATION_CACHE_DAYS) {
  const horizon = addDays(today, -keepDays);
  return sortEvents((stored ?? []).filter((entry) => entry?.end && entry.end > horizon)).slice(
    -MAX_CACHED_EVENTS
  );
}

/** Запомненные события как события — для прогона, которому фид ничего не дал. */
export function rememberedVacationEvents(stored, today) {
  return restoreEvents(pruneVacationEvents(stored, today));
}

/**
 * Свежее прочитанное плюс то, что помним.
 *
 * Правило одно: событие, которого больше нет в фиде, сохраняется, только если оно
 * уже закончилось. Прошедший отпуск не отменяют — его удаляют, подчищая календарь,
 * и тогда прощённые дни не должны задним числом превращаться в долг. А будущий
 * отпуск отменяют и переносят по-настоящему, и удаление в календаре обязано
 * доезжать до приложения.
 *
 * @param {{fresh: Array, cached: Array, today: string}} options
 * @returns {{events: Array, cache: Array, remembered: number}}
 *   `events` — что отдать в collectVacationDays (свежие события как есть, чтобы
 *   счётчики пропущенных не соврали), `cache` — что положить обратно в хранилище.
 */
export function mergeVacationEvents({ fresh, cached, today }) {
  const freshStored = cacheableEvents(fresh);
  const freshKeys = new Set(freshStored.map(eventKey));
  const remembered = pruneVacationEvents(cached, today).filter(
    (entry) => !freshKeys.has(eventKey(entry)) && entry.end <= today
  );

  return {
    events: [...(fresh ?? []), ...restoreEvents(remembered)],
    cache: sortEvents([...freshStored, ...remembered]).slice(-MAX_CACHED_EVENTS),
    remembered: remembered.length,
  };
}

/**
 * Чем событие себя опознаёт при следующем чтении. UID у гугловского фида есть
 * всегда, и по нему правка дат подхватывается как правка, а не как новое событие.
 * Заголовок с границами — запасной ключ для фидов без UID.
 */
function eventKey(entry) {
  return entry.uid ? `uid:${entry.uid}` : `ev:${normalize(entry.summary)}|${entry.start}|${entry.end}`;
}

/** По началу отпуска: при обрезке по размеру уходят самые старые. */
function sortEvents(entries) {
  return [...entries].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}
