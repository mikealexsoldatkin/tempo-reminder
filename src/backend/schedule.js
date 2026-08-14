import { addDays, isoDate, isWeekend } from './workdays.js';

/**
 * Расписание проверок: во что превращается «запускать в 09:00 и 15:00».
 *
 * Триггер Forge объявлен как `interval: hour` — платформа будит функцию примерно
 * раз в час, но ни точную минуту, ни само срабатывание не гарантирует. Поэтому
 * расписание живёт здесь, а не в манифесте: на каждом часовом срабатывании мы
 * сверяем текущее время со списком слотов и решаем, пора или нет.
 *
 * Модуль намеренно без зависимостей от KVS и сети — чистые функции, покрытые тестами.
 */

/**
 * Настройки часового пояса нет: и времена запуска, и выходные, и граница суток —
 * всё в UTC. Константа существует только чтобы подписывать время в UI и в логах.
 */
export const SCHEDULE_TIME_ZONE = 'UTC';

// Больше слотов в сутки просто не нужно, а список в KVS и в UI должен оставаться обозримым.
export const MAX_RUN_TIMES = 12;

/**
 * Насколько давно прошедший слот ещё считается наступившим.
 *
 * Час с запасом: если слот стоит на 09:00, а триггер сработал в 09:47 — прогон
 * должен состояться. Если же триггер молчал полдня, рассылка «за 09:00» в 18:00
 * никому не нужна — такой слот просто сгорает до конца суток.
 */
export const CATCH_UP_MINUTES = 150;

/**
 * Разбор пользовательского ввода: «9, 15:30» → ['09:00', '15:30'].
 * Не бросает исключений — непонятые куски возвращаются отдельным списком,
 * чтобы вызывающий сам решил, ругаться на них или молча отбросить.
 */
export function parseRunTimes(raw) {
  const source = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  const times = new Set();
  const invalid = [];

  for (const token of source.split(/[\s,;]+/).filter(Boolean)) {
    const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(token);
    const hour = match ? Number(match[1]) : NaN;
    const minute = match?.[2] ? Number(match[2]) : 0;
    if (!match || hour > 23 || minute > 59) {
      invalid.push(token);
      continue;
    }
    times.add(formatClock(hour * 60 + minute));
  }

  // Сортировка по возрастанию — на неё опираются dueRunTimes и nextRunTime.
  return { times: [...times].sort(), invalid };
}

export function formatRunTimes(times) {
  return (times ?? []).join(', ');
}

export function formatClock(minutesOfDay) {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function toMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Момент времени → дата и минуты с начала суток, всё в UTC.
 */
export function dayParts(date) {
  return {
    date: isoDate(date),
    minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}

/**
 * Слоты, которые уже наступили в текущих сутках и ещё не отработали.
 *
 * Если триггер пропустил час и наступившими оказались сразу два слота, вернутся оба,
 * но прогон будет один — вызывающий закрывает весь список разом, чтобы человек
 * не получил два одинаковых сообщения подряд.
 */
export function dueRunTimes({
  runTimes,
  nowMinutes,
  handledTimes = [],
  catchUpMinutes = CATCH_UP_MINUTES,
}) {
  const handled = new Set(handledTimes);
  return (runTimes ?? []).filter((time) => {
    if (handled.has(time)) return false;
    const at = toMinutes(time);
    return at <= nowMinutes && nowMinutes - at <= catchUpMinutes;
  });
}

/**
 * Ближайший запланированный запуск — для показа в настройках.
 * Возвращает {date, time} или null, если слотов нет вовсе.
 */
export function nextRunTime({
  runTimes,
  skipWeekends,
  today,
  nowMinutes,
  handledTimes = [],
}) {
  if (!runTimes || runTimes.length === 0) return null;
  const handled = new Set(handledTimes);

  if (!(skipWeekends && isWeekend(today))) {
    const upcoming = runTimes.find((time) => !handled.has(time) && toMinutes(time) > nowMinutes);
    if (upcoming) return { date: today, time: upcoming };
  }

  // Дальше суток заглядывать незачем: список слотов одинаков для всех дней,
  // а длиннее двух выходных подряд пропуск не бывает.
  for (let ahead = 1; ahead <= 7; ahead++) {
    const day = addDays(today, ahead);
    if (skipWeekends && isWeekend(day)) continue;
    return { date: day, time: runTimes[0] };
  }
  return null;
}
