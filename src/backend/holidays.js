/**
 * Календарь праздников: правила и их развёртка в конкретные даты.
 *
 * Праздник хранится правилом, а не списком дат: «последний понедельник мая» должен
 * оставаться верным и через год, без ежегодной ручной правки календаря. Два типа:
 *  - fixed — одно и то же число каждый год (1 января);
 *  - nth-weekday — N-й день недели месяца, где nth < 0 отсчитывается с конца
 *    (последний понедельник мая), плюс необязательный сдвиг offsetDays.
 *
 * Сдвиг нужен для пятницы после Дня благодарения: «4-я пятница ноября» — не то же
 * самое, ведь в годы, где 1 ноября приходится на пятницу, четвёртая пятница
 * оказывается раньше четвёртого четверга.
 *
 * Модуль намеренно без KVS и сети — чистые функции под тестами.
 */

const DAY_MS = 86400000;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Нумерация как у Date#getUTCDay: 0 — воскресенье.
export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export const HOLIDAY_TYPE = { fixed: 'fixed', nthWeekday: 'nth-weekday' };

/**
 * Календарь, с которым приложение стартует. Дальше он живёт в KVS и правится
 * администратором на вкладке Holidays; кнопка «Restore defaults» возвращает этот
 * список.
 *
 * 9 мая здесь общий для всех: делить праздники по странам приложение не умеет,
 * а значит день не спросят и с тех, кто в этот день работает.
 */
export const DEFAULT_HOLIDAYS = [
  { id: 'new-year', name: 'New Year', type: 'fixed', month: 1, day: 1 },
  { id: 'orthodox-christmas', name: 'Orthodox Christmas', type: 'fixed', month: 1, day: 7 },
  { id: 'victory-day', name: 'Victory Day', type: 'fixed', month: 5, day: 9 },
  { id: 'memorial-day', name: 'Memorial Day', type: 'nth-weekday', month: 5, weekday: 1, nth: -1 },
  { id: 'independence-day', name: 'Independence Day', type: 'fixed', month: 7, day: 4 },
  { id: 'labor-day', name: 'Labor Day', type: 'nth-weekday', month: 9, weekday: 1, nth: 1 },
  { id: 'thanksgiving', name: 'Thanksgiving', type: 'nth-weekday', month: 11, weekday: 4, nth: 4 },
  {
    id: 'thanksgiving-friday',
    name: 'Day after Thanksgiving',
    type: 'nth-weekday',
    month: 11,
    weekday: 4,
    nth: 4,
    offsetDays: 1,
  },
  { id: 'catholic-christmas', name: 'Catholic Christmas', type: 'fixed', month: 12, day: 25 },
];

/* ------------------------------ развёртка дат ------------------------------ */

/**
 * Дата праздника в конкретном году — 'YYYY-MM-DD' или null, если правило в этом
 * году не выпадает (например, пятой пятницы в месяце может не быть).
 */
export function holidayDate(holiday, year) {
  if (holiday.type === HOLIDAY_TYPE.fixed) {
    // 29 февраля в невисокосном году сдвигаем на 28-е, а не теряем.
    return toIso(year, holiday.month, Math.min(holiday.day, daysInMonth(year, holiday.month)));
  }

  const day = nthWeekdayOfMonth(year, holiday.month, holiday.weekday, holiday.nth);
  if (day === null) return null;
  return shiftIso(toIso(year, holiday.month, day), holiday.offsetDays ?? 0);
}

/**
 * Проверка «этот день — праздник?» с кэшем по годам: за прогон её зовут на каждый
 * день окна, а правила разворачиваются в даты одинаково для всего года.
 *
 * @param {Array} holidays календарь
 * @returns {(isoDay: string) => object|null} сам праздник или null
 */
export function makeHolidayChecker(holidays) {
  const byYear = new Map();

  const datesOf = (year) => {
    if (!byYear.has(year)) {
      const dates = new Map();
      for (const holiday of holidays ?? []) {
        const date = holidayDate(holiday, year);
        if (date) dates.set(date, holiday);
      }
      byYear.set(year, dates);
    }
    return byYear.get(year);
  };

  return (isoDay) => {
    const year = Number(String(isoDay).slice(0, 4));
    if (!Number.isFinite(year)) return null;
    // Сдвиг может перенести праздник через границу года (31 декабря + 1 день),
    // поэтому смотрим и соседние годы — оба всё равно посчитаются один раз.
    return (
      datesOf(year).get(isoDay) ??
      datesOf(year - 1).get(isoDay) ??
      datesOf(year + 1).get(isoDay) ??
      null
    );
  };
}

/** Ближайшая дата праздника начиная с fromIsoDay — для показа в таблице. */
export function nextHolidayDate(holiday, fromIsoDay) {
  const year = Number(fromIsoDay.slice(0, 4));
  for (const candidate of [year, year + 1, year + 2]) {
    const date = holidayDate(holiday, candidate);
    if (date && date >= fromIsoDay) return date;
  }
  return null;
}

/** Правило человеческими словами: «Last Monday of May». */
export function describeHoliday(holiday) {
  if (holiday.type === HOLIDAY_TYPE.fixed) {
    return `${MONTH_NAMES[holiday.month - 1]} ${holiday.day}`;
  }
  const shift = holiday.offsetDays
    ? ` ${holiday.offsetDays > 0 ? '+' : '−'} ${Math.abs(holiday.offsetDays)} day${
        Math.abs(holiday.offsetDays) === 1 ? '' : 's'
      }`
    : '';
  return `${ordinal(holiday.nth)} ${WEEKDAY_NAMES[holiday.weekday]} of ${
    MONTH_NAMES[holiday.month - 1]
  }${shift}`;
}

/** Календарь для UI: к каждому правилу — его расшифровка и ближайшая дата. */
export function describeHolidays(holidays, fromIsoDay) {
  return (holidays ?? []).map((holiday) => ({
    ...holiday,
    when: describeHoliday(holiday),
    nextDate: nextHolidayDate(holiday, fromIsoDay),
  }));
}

/* -------------------------------- разбор ввода -------------------------------- */

/**
 * Проверка того, что администратор ввёл в форме. Молча подставлять что-то своё
 * тут нельзя: незамеченная опечатка в правиле — это молча пропущенный праздник.
 */
export function normalizeHoliday(raw) {
  const name = String(raw?.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Give the holiday a name');

  const month = intIn(raw?.month, 1, 12, 'month');
  const id = String(raw?.id ?? '').trim() || makeId(name);

  if (raw?.type === HOLIDAY_TYPE.fixed) {
    const day = intIn(raw?.day, 1, 31, 'day');
    // Февраль проверяем по високосному году: 29 февраля — законное правило.
    const maxDay = daysInMonth(2024, month);
    if (day > maxDay) {
      throw new Error(`${MONTH_NAMES[month - 1]} has only ${maxDay} days`);
    }
    return { id, name, type: HOLIDAY_TYPE.fixed, month, day };
  }

  if (raw?.type === HOLIDAY_TYPE.nthWeekday) {
    const weekday = intIn(raw?.weekday, 0, 6, 'weekday');
    const nth = intIn(raw?.nth, -5, 5, 'position');
    if (nth === 0) throw new Error('Position can’t be zero: use 1…5 or −1 for the last one');
    const offsetDays = raw?.offsetDays === undefined || raw?.offsetDays === null || raw?.offsetDays === ''
      ? 0
      : intIn(raw.offsetDays, -6, 6, 'shift');
    return { id, name, type: HOLIDAY_TYPE.nthWeekday, month, weekday, nth, offsetDays };
  }

  throw new Error(`Unknown holiday type: ${raw?.type}`);
}

/* -------------------------------- внутреннее -------------------------------- */

/**
 * Число месяца, на которое приходится nth-й день недели. nth > 0 — с начала месяца,
 * nth < 0 — с конца. null, если такого дня в месяце нет (пятый понедельник бывает не всегда).
 */
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const total = daysInMonth(year, month);

  if (nth > 0) {
    const firstMatch = 1 + ((weekday - weekdayOf(year, month, 1) + 7) % 7);
    const day = firstMatch + (nth - 1) * 7;
    return day <= total ? day : null;
  }

  const lastMatch = total - ((weekdayOf(year, month, total) - weekday + 7) % 7);
  const day = lastMatch + (nth + 1) * 7;
  return day >= 1 ? day : null;
}

function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function shiftIso(isoDay, days) {
  if (!days) return isoDay;
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function ordinal(nth) {
  if (nth === -1) return 'Last';
  if (nth < 0) return `${ordinal(-nth)} to last`;
  return ['', '1st', '2nd', '3rd', '4th', '5th'][nth] ?? `${nth}th`;
}

function intIn(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new Error(`The ${label} must be a whole number`);
  }
  if (number < min || number > max) {
    throw new Error(`The ${label} must be between ${min} and ${max}, got ${number}`);
  }
  return number;
}

function makeId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  return `${slug || 'holiday'}-${Date.now().toString(36)}`;
}
