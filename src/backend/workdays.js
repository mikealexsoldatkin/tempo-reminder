/**
 * Календарная арифметика на строках YYYY-MM-DD.
 *
 * Дата, а не Date: и день недели, и границы окна должны считаться в часовом поясе
 * из настроек, а не в UTC рантайма. Момент времени переводится в локальную дату
 * один раз (schedule.js), дальше работаем с датой без времени — это избавляет
 * от переходов на летнее время в промежуточных вычислениях.
 */

const DAY_MS = 86400000;

function toUtcMidnight(isoDay) {
  const ms = Date.parse(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${isoDay}`);
  return ms;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(isoDay) {
  const dow = new Date(toUtcMidnight(isoDay)).getUTCDay(); // 0=Вс, 6=Сб
  return dow === 0 || dow === 6;
}

export function addDays(isoDay, days) {
  return isoDate(new Date(toUtcMidnight(isoDay) + days * DAY_MS));
}

// Предохранитель от бесконечного отсчёта: календарь праздников задаёт человек, и
// правило вроде «каждый день — праздник» не должно вешать функцию в очереди.
const MAX_DAYS_TO_WALK_BACK = 400;

/**
 * Последние `count` рабочих дней по состоянию на isoToday, от старых к свежим.
 * Сам isoToday входит в список, если он рабочий; если проверка запущена в выходной
 * или в праздник, отсчёт начинается с ближайшего рабочего дня назад.
 *
 * Дни возвращаются списком, а не парой границ: проверка идёт по каждому дню
 * отдельно, и выходные с праздниками внутри окна в ней не участвуют.
 *
 * @param isoToday
 * @param count
 * @param {(isoDay: string) => unknown} [isHoliday] что считать праздником
 */
export function lastWorkingDays(isoToday, count, isHoliday = () => null) {
  const days = [];
  let cursor = isoToday;

  for (let walked = 0; days.length < count; walked++) {
    if (walked > MAX_DAYS_TO_WALK_BACK) {
      throw new Error(
        `Couldn’t find ${count} working days before ${isoToday} — check the holiday calendar`
      );
    }
    if (!isWeekend(cursor) && !isHoliday(cursor)) days.unshift(cursor);
    cursor = addDays(cursor, -1);
  }
  return days;
}

/**
 * Дни, за которые время уже обязано быть залогировано: из окна выбрасываются
 * `acceptableDelayDays` самых свежих рабочих дней — на них задержка допустима.
 *
 * @param {string[]} days рабочие дни окна от старых к свежим
 * @param {number} acceptableDelayDays сколько последних дней прощаем
 */
export function daysToReport(days, acceptableDelayDays) {
  return days.slice(0, Math.max(days.length - Math.max(acceptableDelayDays, 0), 0));
}

/** Границы окна для запроса в Tempo и для текста сообщений. */
export function windowOf(days) {
  return { from: days[0], to: days[days.length - 1] };
}
