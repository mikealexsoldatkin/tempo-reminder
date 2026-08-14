import { fetch } from '@forge/api';
import { parseIcs } from './ics.js';
import { collectVacationDays, indexPeople, matchPeople } from './vacations.js';
import { addDays } from './workdays.js';

/**
 * Загрузка корпоративного календаря отпусков.
 *
 * Доступ — по «Secret address in iCal format» из настроек календаря: ссылка сама
 * себе пароль, поэтому лежит в секретном хранилище Forge рядом с токенами Tempo
 * и Slack. Ни OAuth, ни сервисных аккаунтов, ни проекта в GCP не требуется.
 *
 * Важная особенность этого фида: Google отдаёт его из кэша, так что событие,
 * добавленное HR только что, приложение увидит с задержкой (обычно до нескольких
 * часов). Для отпусков, которые заводят заранее, это приемлемо.
 */

// Фид отдаётся только этим хостом, он же объявлен в egress манифеста. Проверка
// нужна не ради безопасности (Forge всё равно не пустит дальше), а ради понятной
// ошибки в UI вместо «fetch failed».
const CALENDAR_HOST = 'calendar.google.com';

/**
 * Отпускные дни отслеживаемых людей за окно.
 *
 * @param {{ icsUrl: string, people: Array, range: {from: string, to: string} }} options
 * @returns {Promise<{daysByPerson: Map<string, Set<string>>, matchedEvents: number, unmatched: Array, recurringSkipped: number, timedSkipped: number, calendarName: string|null, totalEvents: number}>}
 */
export async function getVacationDays({ icsUrl, people, range }) {
  const { calendarName, events } = await fetchCalendar(icsUrl);
  return {
    calendarName,
    totalEvents: events.length,
    ...collectVacationDays(events, people, range),
  };
}

/**
 * Проверка подключения для страницы настроек.
 *
 * Отвечает не только «календарь читается», но и как раскладываются заголовки на
 * список отслеживаемых: без этого администратор узнавал бы о том, что имя в
 * календаре написано иначе, только по неожиданному напоминанию отпускнику.
 *
 * @param {{ icsUrl: string, people: Array, today: string }} options
 */
export async function testVacationCalendar({ icsUrl, people, today }) {
  try {
    const { calendarName, events, cancelled } = await fetchCalendar(icsUrl);
    // Окно шире окна проверки: администратору полезнее видеть и будущие отпуска —
    // по ним понятно, что календарь тот самый и имена в нём разбираются верно.
    const range = { from: addDays(today, -PREVIEW_DAYS_BACK), to: addDays(today, PREVIEW_DAYS_AHEAD) };
    const collected = collectVacationDays(events, people, range);
    const index = indexPeople(people);

    const onLeaveToday = people
      .filter((person) => collected.daysByPerson.get(person.accountId)?.has(today))
      .map((person) => person.displayName);

    const upcoming = events
      .filter((event) => event.allDay && event.start && event.end && event.end > today)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, PREVIEW_EVENTS)
      .map((event) => ({
        title: event.summary,
        // Показываем включительную границу: `[vacation] X` с 10 по 15 в фиде
        // означает, что человек отсутствует по 14-е, и в UI должно быть видно это.
        from: event.start,
        to: addDays(event.end, -1),
        matched: matchPeople(event.summary, index).length > 0,
      }));

    return {
      ok: true,
      message:
        `Calendar${calendarName ? ` “${calendarName}”` : ''} read: ${events.length} events` +
        `${cancelled > 0 ? ` (${cancelled} cancelled ignored)` : ''}. ` +
        `Matched to tracked people: ${collected.matchedEvents} events in ` +
        `${range.from}…${range.to}. On leave today: ${onLeaveToday.length}.`,
      calendarName,
      totalEvents: events.length,
      matchedEvents: collected.matchedEvents,
      unmatched: collected.unmatched.slice(0, PREVIEW_UNMATCHED),
      unmatchedTotal: collected.unmatched.length,
      recurringSkipped: collected.recurringSkipped,
      timedSkipped: collected.timedSkipped,
      onLeaveToday,
      upcoming,
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

const PREVIEW_DAYS_BACK = 30;
const PREVIEW_DAYS_AHEAD = 90;
const PREVIEW_EVENTS = 15;
const PREVIEW_UNMATCHED = 10;

/* ------------------------------ загрузка ------------------------------ */

async function fetchCalendar(icsUrl) {
  const url = validateUrl(icsUrl);

  const res = await fetch(url, { headers: { Accept: 'text/calendar' } });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'Google returned 404: the secret iCal address is no longer valid. It changes when the ' +
          'calendar owner resets it — copy the current one from the calendar settings.'
      );
    }
    throw new Error(`Google returned ${res.status} for the iCal address`);
  }

  const text = await res.text();
  // Тот же 200 Google отдаёт и на страницу входа: без этой проверки парсер вернул
  // бы ноль событий, и в UI это выглядело бы как «в календаре нет отпусков».
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error(
      'The address did not return a calendar. Make sure it is the “Secret address in iCal format” ' +
        'ending with .ics, not a link to the calendar page.'
    );
  }

  const parsed = parseIcs(text);
  if (parsed.events.length === 0) {
    console.warn('Календарь отпусков прочитан, но событий в нём нет');
  }
  return parsed;
}

function validateUrl(icsUrl) {
  const raw = String(icsUrl ?? '').trim();
  if (!raw) throw new Error('The vacation calendar iCal address is not set');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The vacation calendar address is not a valid URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== CALENDAR_HOST) {
    throw new Error(`The address must be an https link to ${CALENDAR_HOST}`);
  }
  return url.toString();
}
