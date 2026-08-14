import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyReport, formatDailyReport } from '../src/backend/dailyReport.js';
import { eachDay } from '../src/backend/workdays.js';

const entry = (day, overrides = {}) => ({
  day,
  issueId: 10001,
  issueKey: 'ABC-1',
  description: 'Fixed the importer',
  workTypes: ['Development'],
  timeSpentSeconds: 3600,
  startTime: '10:00:00',
  ...overrides,
});

// Пн 2026-08-10 … Пт 2026-08-14, суббота и воскресенье — 15 и 16 августа.
const week = { from: '2026-08-10', to: '2026-08-14' };

/* ------------------------------ окно целиком ------------------------------ */

test('в отчёт попадает каждый календарный день окна, включая пустые', () => {
  const days = buildDailyReport({ window: week, worklogs: [entry('2026-08-12')] });
  assert.deepEqual(
    days.map((d) => d.date),
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
  );
  assert.equal(days[2].entries.length, 1);
  assert.equal(days[2].reason, null);
});

test('окно захватывает выходные, если они внутри него', () => {
  assert.deepEqual(eachDay('2026-08-14', '2026-08-17'), [
    '2026-08-14',
    '2026-08-15',
    '2026-08-16',
    '2026-08-17',
  ]);
  assert.deepEqual(eachDay('2026-08-14', '2026-08-13'), []);
});

/* ------------------------------ причины пустых дней ------------------------------ */

test('под пустым днём стоит причина: выходной, праздник, отпуск или ничего из этого', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-13', to: '2026-08-17' },
    worklogs: [],
    isHoliday: (day) => (day === '2026-08-14' ? { name: 'Test Day' } : null),
    vacationDays: new Set(['2026-08-17']),
  });
  assert.deepEqual(
    days.map((d) => [d.date, d.reason]),
    [
      ['2026-08-13', 'no time entries'],
      ['2026-08-14', 'Test Day — a holiday'],
      ['2026-08-15', 'weekend'],
      ['2026-08-16', 'weekend'],
      ['2026-08-17', 'on leave'],
    ]
  );
});

test('день с записями причины не получает, даже если это выходной', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-15', to: '2026-08-15' },
    worklogs: [entry('2026-08-15')],
  });
  assert.equal(days[0].reason, null);
  assert.equal(days[0].entries.length, 1);
});

/* --------------------------------- формат --------------------------------- */

test('строка записи — часы, ключ задачи, work attribute и описание', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-10', to: '2026-08-10' },
    worklogs: [entry('2026-08-10')],
  });
  assert.equal(formatDailyReport(days), '2026-08-10:\n- 1h - ABC-1: [Development] Fixed the importer');
});

test('часы дробные: хвостовые нули не пишем, а четверть часа не схлопывается в 0h', () => {
  const hoursOf = (timeSpentSeconds) => {
    const days = buildDailyReport({
      window: { from: '2026-08-10', to: '2026-08-10' },
      worklogs: [entry('2026-08-10', { timeSpentSeconds })],
    });
    return formatDailyReport(days).split('\n')[1].split(' ')[1];
  };
  assert.equal(hoursOf(5400), '1.5h');
  assert.equal(hoursOf(900), '0.25h');
  assert.equal(hoursOf(28800), '8h');
  assert.equal(hoursOf(0), '0h');
});

test('без work attribute квадратных скобок в строке нет', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-10', to: '2026-08-10' },
    worklogs: [entry('2026-08-10', { workTypes: [] })],
  });
  assert.equal(formatDailyReport(days), '2026-08-10:\n- 1h - ABC-1: Fixed the importer');
});

test('пустое описание заменяется заголовком задачи, а без него — заглушкой', () => {
  const window = { from: '2026-08-10', to: '2026-08-10' };
  const withSummary = buildDailyReport({
    window,
    worklogs: [entry('2026-08-10', { description: '', issueSummary: 'Importer rewrite' })],
  });
  assert.equal(formatDailyReport(withSummary), '2026-08-10:\n- 1h - ABC-1: [Development] Importer rewrite');

  const bare = buildDailyReport({
    window,
    worklogs: [entry('2026-08-10', { description: '', issueSummary: null })],
  });
  assert.equal(formatDailyReport(bare), '2026-08-10:\n- 1h - ABC-1: [Development] no description');
});

test('не добранный из Jira ключ заменяется id задачи — её всё ещё можно найти', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-10', to: '2026-08-10' },
    worklogs: [entry('2026-08-10', { issueKey: null, issueId: 10077 })],
  });
  assert.equal(
    formatDailyReport(days),
    '2026-08-10:\n- 1h - issue #10077: [Development] Fixed the importer'
  );
});

test('записи одного дня идут по времени начала работы', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-10', to: '2026-08-10' },
    worklogs: [
      entry('2026-08-10', { startTime: '15:00:00', issueKey: 'ABC-9', description: 'Later' }),
      entry('2026-08-10', { startTime: '09:00:00', issueKey: 'ABC-2', description: 'Earlier' }),
    ],
  });
  assert.deepEqual(
    days[0].entries.map((e) => e.description),
    ['Earlier', 'Later']
  );
});

test('несколько work attribute перечисляются в одних скобках', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-10', to: '2026-08-10' },
    worklogs: [entry('2026-08-10', { workTypes: ['Development', 'Billable'] })],
  });
  assert.equal(
    formatDailyReport(days),
    '2026-08-10:\n- 1h - ABC-1: [Development, Billable] Fixed the importer'
  );
});

test('дни идут блоками: дата, под ней строки', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-14', to: '2026-08-15' },
    worklogs: [entry('2026-08-14')],
  });
  assert.equal(
    formatDailyReport(days),
    '2026-08-14:\n- 1h - ABC-1: [Development] Fixed the importer\n2026-08-15:\n- weekend'
  );
});

/* -------------------------------- лимиты -------------------------------- */

test('слишком длинный отчёт теряет самые старые дни, и об этом сказано', () => {
  const days = buildDailyReport({
    window: { from: '2026-08-10', to: '2026-08-14' },
    worklogs: eachDay('2026-08-10', '2026-08-14').map((day) => entry(day)),
  });
  // Блок одного дня — 58 символов, значит лимита хватает ровно на два последних.
  const text = formatDailyReport(days, { maxChars: 120 });
  assert.match(text, /^…3 earlier days are not shown/);
  assert.ok(text.includes('2026-08-14:'));
  assert.ok(!text.includes('2026-08-11:'));
});

test('хвост записей за день сворачивается', () => {
  const worklogs = Array.from({ length: 33 }, (_, i) =>
    entry('2026-08-10', { startTime: `${String(i % 24).padStart(2, '0')}:00:00` })
  );
  const days = buildDailyReport({ window: { from: '2026-08-10', to: '2026-08-10' }, worklogs });
  const lines = formatDailyReport(days).split('\n');
  assert.equal(lines.length, 32); // дата + 30 строк + свёрнутый хвост
  assert.equal(lines[31], '- …and 3 more entries');
});
