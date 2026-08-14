/**
 * Детальный отчёт по одному сотруднику: что он списывал в Tempo за каждый день окна.
 *
 * Отличие от обычной проверки — не «есть записи или нет», а их содержимое, и окно
 * берётся сплошняком, без скидки на acceptable delay: менеджер, который смотрит
 * человека глубоко, должен видеть и сегодняшний день, даже если время за него ещё
 * могут донести. Единственное, что оправдывает пустой день, — выходной, праздник
 * или отпуск, и такой день не выпадает из отчёта, а подписывается причиной: пустая
 * строка под датой неотличима от «приложение недосчиталось записей».
 *
 * Модуль без сети и без KVS — чистые функции под тестами.
 */

import { eachDay, isWeekend } from './workdays.js';

// Сообщение в Slack ограничено 40 000 символов, но столько никто не читает.
// Записей за день больше тридцати не бывает, а если бывает — хвост сворачивается.
const MAX_ENTRIES_PER_DAY = 30;
const MAX_REPORT_CHARS = 12000;

/**
 * День за днём: что списано и, если ничего, — почему.
 *
 * @param {{
 *   window: {from: string, to: string},
 *   worklogs: Array,
 *   isHoliday?: (isoDay: string) => object|null,
 *   vacationDays?: Set<string>|null
 * }} options
 * @returns {Array<{date: string, entries: Array, reason: string|null}>} от старых дней к свежим
 */
export function buildDailyReport({ window, worklogs, isHoliday = () => null, vacationDays = null }) {
  const byDay = new Map();
  for (const entry of worklogs ?? []) {
    if (!entry?.day) continue;
    if (!byDay.has(entry.day)) byDay.set(entry.day, []);
    byDay.get(entry.day).push(entry);
  }

  return eachDay(window.from, window.to).map((date) => {
    const entries = sortEntries(byDay.get(date) ?? []);
    return {
      date,
      entries,
      reason: entries.length > 0 ? null : reasonFor(date, isHoliday, vacationDays),
    };
  });
}

/**
 * Почему за день нет записей. Праздник проверяется первым: он информативнее
 * «выходного», когда выпадает на будни, а на субботу выпадает редко.
 *
 * Календарь праздников и календарь отпусков подключены настройками — если они
 * выключены, сюда приходят пустые проверки и день честно остаётся «no time entries».
 */
function reasonFor(date, isHoliday, vacationDays) {
  const holiday = isHoliday(date);
  if (holiday) return `${holiday.name} — a holiday`;
  if (isWeekend(date)) return 'weekend';
  if (vacationDays?.has(date)) return 'on leave';
  return 'no time entries';
}

/** Внутри дня — в порядке начала работы: так строки читаются как рабочий день. */
function sortEntries(entries) {
  return [...entries].sort(
    (a, b) =>
      String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')) ||
      String(a.issueKey ?? a.issueId ?? '').localeCompare(String(b.issueKey ?? b.issueId ?? ''))
  );
}

/**
 * Отчёт текстом для Slack:
 *
 *   2026-08-12:
 *   - 1.5h - ABC-1: [Development] Fixed the importer
 *   2026-08-13:
 *   - weekend
 *
 * Если отчёт не влезает в лимит, отрезаются самые старые дни: свежие нужнее, а
 * молча потерянный кусок хуже строки о том, что он потерян.
 */
export function formatDailyReport(days, { maxChars = MAX_REPORT_CHARS } = {}) {
  const blocks = (days ?? []).map(formatDay);
  const kept = [];
  let length = 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const grown = length + blocks[i].length + 1;
    if (kept.length > 0 && grown > maxChars) {
      const dropped = i + 1;
      kept.unshift(`…${dropped} earlier ${dropped === 1 ? 'day is' : 'days are'} not shown — the report is too long`);
      break;
    }
    kept.unshift(blocks[i]);
    length = grown;
  }
  return kept.join('\n');
}

function formatDay(day) {
  if (day.entries.length === 0) return `${day.date}:\n- ${day.reason}`;

  const shown = day.entries.slice(0, MAX_ENTRIES_PER_DAY).map(formatEntry);
  const hidden = day.entries.length - shown.length;
  if (hidden > 0) shown.push(`- …and ${hidden} more ${hidden === 1 ? 'entry' : 'entries'}`);
  return [`${day.date}:`, ...shown].join('\n');
}

/** `- 1.5h - ABC-123: [Development] Fixed the importer` */
function formatEntry(entry) {
  const workType = entry.workTypes?.length > 0 ? `[${entry.workTypes.join(', ')}] ` : '';
  return `- ${formatHours(entry.timeSpentSeconds)} - ${issueLabel(entry)}: ${workType}${describeWork(entry)}`;
}

/**
 * Списанное время часами. Дробную часть округляем до сотых и хвостовые нули убираем:
 * 1.5h читается лучше, чем 1.50h, а 15 минут (0.25h) не должны схлопнуться в 0h.
 */
function formatHours(timeSpentSeconds) {
  const hours = (Number(timeSpentSeconds) || 0) / 3600;
  return `${Number(hours.toFixed(2))}h`;
}

/** Ключ задачи, а если Jira его не отдала — хотя бы id, чтобы задачу можно было найти. */
function issueLabel(entry) {
  if (entry.issueKey) return entry.issueKey;
  return entry.issueId ? `issue #${entry.issueId}` : 'no issue';
}

/**
 * Описание из worklog'а. Оно необязательное, и списанный молча час превратился бы
 * в строку из одного ключа — в этом случае подставляем заголовок задачи.
 */
function describeWork(entry) {
  return entry.description || entry.issueSummary || 'no description';
}
