import { fetch } from '@forge/api';
import { parseIcs } from './ics.js';
import {
  collectVacationDays,
  indexPeople,
  matchPeople,
  mergeVacationEvents,
  rememberedVacationEvents,
} from './vacations.js';
import { getCachedVacationEvents, saveCachedVacationEvents } from './store.js';
import { sleep } from './tempo.js';
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
 * Прочитанное запоминается, а неудачное чтение подменяется запомненным: отказ
 * Google не должен превращаться в «отпусков не было». Различаем три исхода —
 * фид прочитан (свежие события плюс уже закончившиеся из памяти), фид не
 * прочитан (только память) и фид отдал пустоту при непустой памяти (тоже только
 * память: пустой ответ от кэширующего гугловского фида — это почти всегда не
 * «отпуска кончились»).
 *
 * @param {{ icsUrl: string, people: Array, range: {from: string, to: string}, today?: string }} options
 * @returns {Promise<{daysByPerson: Map<string, Set<string>>, matchedEvents: number, unmatched: Array, recurringSkipped: number, timedSkipped: number, calendarName: string|null, totalEvents: number, stale: boolean, remembered: number, warning: string|null, cachedAt: string|null}>}
 */
export async function getVacationDays({ icsUrl, people, range, today = range.to }) {
  const cached = await getCachedVacationEvents();
  const fallback = () => rememberedVacationEvents(cached.events, today);

  let calendarName = null;
  let totalEvents = 0;
  let events;
  let remembered = 0;
  let stale = false;
  let warning = null;

  try {
    const feed = await fetchCalendar(icsUrl);
    calendarName = feed.calendarName;
    totalEvents = feed.events.length;

    const known = fallback();
    if (totalEvents === 0 && known.length > 0) {
      events = known;
      remembered = known.length;
      stale = true;
      warning =
        'The vacation calendar came back empty while it had events before — the remembered copy ' +
        `from ${describeAge(cached.fetchedAt)} was used and the calendar was left as is`;
    } else {
      const merged = mergeVacationEvents({ fresh: feed.events, cached: cached.events, today });
      events = merged.events;
      remembered = merged.remembered;
      await saveCachedVacationEvents(merged.cache);
    }
  } catch (e) {
    const known = fallback();
    // Нечем подстраховаться — пусть вызывающий решает, как быть с ошибкой: это
    // ровно то поведение, что было до появления памяти.
    if (known.length === 0) throw e;

    events = known;
    remembered = known.length;
    stale = true;
    warning = `Couldn’t read the vacation calendar: ${e.message} — the remembered copy from ${describeAge(cached.fetchedAt)} was used instead`;
  }

  return {
    calendarName,
    totalEvents,
    stale,
    remembered,
    warning,
    cachedAt: cached.fetchedAt,
    ...collectVacationDays(events, people, range),
  };
}

/** «2026-09-15T06:00:00Z (2 days ago)» — возраст страховки важнее самой метки. */
function describeAge(fetchedAt) {
  if (!fetchedAt) return 'an earlier read';
  const ageMs = Date.now() - Date.parse(fetchedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return fetchedAt;

  const hours = Math.floor(ageMs / 3600000);
  if (hours < 1) return `${fetchedAt} (less than an hour ago)`;
  if (hours < 48) return `${fetchedAt} (${hours}h ago)`;
  return `${fetchedAt} (${Math.floor(hours / 24)} days ago)`;
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

/**
 * Чтение фида с ретраями.
 *
 * Повторяем то, что бывает разовым: оборванный запрос, 429 и 5xx. Ответы, которые
 * повтором не исправить, — 404 на сброшенный secret-адрес, прочие 4xx и страницу
 * входа вместо календаря — бросаем сразу: три попытки подряд получить тот же 404
 * только съедят время прогона.
 *
 * Причина отдельного внимания к сети: пропущенный ответ Google раньше означал
 * «отпусков нет» и превращался в напоминания тем, кого на работе не было.
 */
const FETCH_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

async function fetchCalendar(icsUrl) {
  const url = validateUrl(icsUrl);

  for (let attempt = 1; ; attempt++) {
    try {
      return await readCalendar(url);
    } catch (e) {
      if (!e.retryable || attempt >= FETCH_ATTEMPTS) throw e;
      const waitMs = RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(
        `Календарь отпусков: ${e.message}; попытка ${attempt}/${FETCH_ATTEMPTS - 1} через ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
}

async function readCalendar(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'text/calendar' } });
  } catch (e) {
    // Сеть отвалилась — именно тот случай, ради которого здесь ретраи.
    throw retryable(new Error(`the request to Google failed (${e.message})`));
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'Google returned 404: the secret iCal address is no longer valid. It changes when the ' +
          'calendar owner resets it — copy the current one from the calendar settings.'
      );
    }
    const error = new Error(`Google returned ${res.status} for the iCal address`);
    throw res.status === 429 || res.status >= 500 ? retryable(error) : error;
  }

  let text;
  try {
    text = await res.text();
  } catch (e) {
    // Заголовки пришли, тело оборвалось — повторяем так же, как оборванный запрос.
    throw retryable(new Error(`the calendar body could not be read (${e.message})`));
  }
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

/** Пометка «это стоит повторить» — читается в fetchCalendar. */
function retryable(error) {
  error.retryable = true;
  return error;
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
