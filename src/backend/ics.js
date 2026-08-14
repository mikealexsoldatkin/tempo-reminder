/**
 * Разбор iCalendar-фида (RFC 5545) до того минимума, который нужен приложению:
 * заголовок события и дни, которые оно занимает.
 *
 * Своя разборка, а не библиотека: из всего формата нас интересуют три свойства
 * (SUMMARY, DTSTART, DTEND) у событий на весь день, а тащить в Forge-бандл
 * полноценный парсер календарей ради этого незачем.
 *
 * Модуль намеренно без зависимостей и без сети — чистые функции под тестами.
 */

/**
 * События из текста фида. Порядок сохраняется, служебные блоки (VTIMEZONE,
 * VALARM и прочее) игнорируются.
 *
 * @param {string} text содержимое .ics
 * @returns {{
 *   calendarName: string|null,
 *   events: Array<{uid: string|null, summary: string, allDay: boolean, start: string|null, end: string|null, recurring: boolean}>,
 *   cancelled: number
 * }}
 *   У события на весь день `start` включительно, `end` — исключительно (как в
 *   самом формате). Отменённые события не возвращаются, но считаются.
 */
export function parseIcs(text) {
  const lines = unfold(String(text ?? ''));
  const events = [];
  let calendarName = null;
  let cancelled = 0;

  // Глубина вложенности, а не флаг: у VEVENT внутри может быть VALARM, и его
  // END:VALARM не должен закрывать само событие.
  let current = null;
  let depth = 0;

  for (const line of lines) {
    const { name, params, value } = parseLine(line);

    if (name === 'BEGIN') {
      if (value === 'VEVENT' && depth === 0) {
        current = { uid: null, summary: '', allDay: false, start: null, end: null, recurring: false };
        depth = 1;
      } else if (current) {
        depth++;
      }
      continue;
    }

    if (name === 'END') {
      if (!current) continue;
      depth--;
      if (depth === 0) {
        if (current.status === 'CANCELLED') cancelled++;
        else events.push(finishEvent(current));
        current = null;
      }
      continue;
    }

    if (!current) {
      // Свойства самого календаря: имя пригодится в диагностике подключения.
      if (name === 'X-WR-CALNAME') calendarName = unescapeText(value);
      continue;
    }
    // Свойства вложенных блоков (например, TRIGGER у VALARM) событию не принадлежат.
    if (depth > 1) continue;

    switch (name) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'STATUS':
        current.status = value.toUpperCase();
        break;
      case 'RRULE':
        current.recurring = true;
        break;
      case 'DTSTART':
        Object.assign(current, readDate(params, value, 'start'));
        break;
      case 'DTEND':
        Object.assign(current, readDate(params, value, 'end'));
        break;
      default:
        break;
    }
  }

  return { calendarName, events, cancelled };
}

/**
 * Событие на весь день без DTEND занимает один день. По RFC отсутствующий DTEND
 * означает нулевую длительность, но у all-day это ровно сутки — Google так и
 * пишет одиночные дни.
 */
function finishEvent(event) {
  const { status, ...rest } = event;
  if (rest.allDay && rest.start && !rest.end) rest.end = addDay(rest.start);
  return rest;
}

/**
 * DTSTART/DTEND. Нас интересуют только события на весь день: у них значение —
 * дата без времени (VALUE=DATE, `20260817`), и никакой таймзоны, а значит и
 * никакой неоднозначности «в чьём поясе этот день».
 *
 * У событий со временем берём только календарную дату — она нужна лишь для того,
 * чтобы диагностика могла показать такое событие; в отпуска они не попадают.
 */
function readDate(params, value, field) {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly && (params.VALUE === 'DATE' || value.length === 8)) {
    return { allDay: true, [field]: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}` };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T/.exec(value);
  if (dateTime) {
    return { allDay: false, [field]: `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}` };
  }
  return {};
}

/**
 * Снятие переносов: продолжение свойства начинается с пробела или табуляции.
 * Google переносит длинные SUMMARY именно так, и без склейки имя в заголовке
 * могло бы разорваться посередине.
 */
function unfold(text) {
  const lines = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(raw) && lines.length > 0) lines[lines.length - 1] += raw.slice(1);
    else if (raw.length > 0) lines.push(raw);
  }
  return lines;
}

/**
 * `DTSTART;VALUE=DATE:20260817` → { name, params, value }.
 *
 * Двоеточие ищем вне кавычек: в параметрах встречаются значения в кавычках,
 * внутри которых двоеточие законно (например, TZID="…:…").
 */
function parseLine(line) {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return { name: line.toUpperCase(), params: {}, value: '' };

  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '').toUpperCase();
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Экранирование текстовых значений: \n, \, \; \\ */
function unescapeText(value) {
  return String(value)
    .replace(/\\[nN]/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/* ------------------------------- даты ------------------------------- */

const DAY_MS = 86400000;

function addDay(isoDay) {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Дни, которые занимает событие на весь день, — с обрезкой по запрошенному окну.
 * DTEND исключительный: отпуск 10–14 августа приезжает как 10 → 15.
 *
 * @param {{allDay: boolean, start: string|null, end: string|null}} event
 * @param {{from: string, to: string}} range включительно с обеих сторон
 * @returns {string[]}
 */
export function eventDays(event, range) {
  if (!event.allDay || !event.start) return [];

  const endExclusive = event.end ?? addDay(event.start);
  const days = [];
  let cursor = event.start > range.from ? event.start : range.from;

  // Предохранитель на случай события длиной в годы: окно проверки всё равно
  // короткое, а раскручивать весь такой отпуск незачем.
  while (cursor < endExclusive && cursor <= range.to && days.length <= 400) {
    days.push(cursor);
    cursor = addDay(cursor);
  }
  return days;
}
