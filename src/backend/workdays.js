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

/**
 * Окно [from..to], где to — переданный день, а from отстоит на lookback рабочих дней назад
 * (выходные при отсчёте не учитываются: в понедельник окно перепрыгивает через субботу-воскресенье).
 */
export function workingDayWindow(isoToday, lookbackWorkingDays) {
  let cursor = isoToday;
  let counted = 0;
  while (counted < lookbackWorkingDays) {
    cursor = addDays(cursor, -1);
    if (!isWeekend(cursor)) counted++;
  }
  return { from: cursor, to: isoToday };
}
