/**
 * Расчёт окна «последние N рабочих дней» в UTC.
 * У Forge scheduledTrigger нет cron, поэтому выходные и границы окна считаем сами.
 */

export function isWeekend(date) {
  const dow = date.getUTCDay(); // 0=Вс, 6=Сб
  return dow === 0 || dow === 6;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Окно [from..to], где to — сегодня, а from отстоит на lookback рабочих дней назад
 * (выходные при отсчёте не учитываются: в понедельник окно перепрыгивает через субботу-воскресенье).
 */
export function workingDayWindow(today, lookbackWorkingDays) {
  let cursor = new Date(today);
  let counted = 0;
  while (counted < lookbackWorkingDays) {
    cursor = addDays(cursor, -1);
    if (!isWeekend(cursor)) counted++;
  }
  return { from: isoDate(cursor), to: isoDate(today) };
}
