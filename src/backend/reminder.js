import {
  cacheManagerSlackUserIds,
  cacheSlackUserIds,
  getCredentials,
  getHandledRunTimes,
  getHolidays,
  getManagers,
  getSettings,
  getTrackedUsers,
  markRunTimesHandled,
  saveLastReport,
  setRunStatus,
} from './store.js';
import { getWorklogDaysByAuthor, sleep } from './tempo.js';
import { lookupSlackUserByEmail, sendSlackDm } from './slack.js';
import { daysToReport, isWeekend, lastWorkingDays, windowOf } from './workdays.js';
import {
  CATCH_UP_MINUTES,
  SCHEDULE_TIME_ZONE,
  dayParts,
  dueRunTimes,
  formatClock,
  nextRunTime,
} from './schedule.js';
import { makeHolidayChecker } from './holidays.js';
import {
  countManagedPeople,
  countWithoutManager,
  groupByManager,
  renderManagerAllClearMessage,
  renderManagerMessage,
  renderUserMessage,
} from './notifications.js';

export const OUTCOME = {
  reminded: 'reminded',
  logged: 'logged',
  notified: 'notified',
  allClear: 'all-clear',
  noEmail: 'no-email',
  noSlack: 'no-slack',
  error: 'error',
};

/**
 * Две независимые рассылки с раздельными расписаниями: напоминания самим
 * сотрудникам и дайджесты их менеджерам.
 */
export const RUN_KIND = { users: 'users', managers: 'managers' };

// Паузы, чтобы не упереться в rate limit Slack (lookupByEmail — Tier 3, postMessage — ~1 msg/s).
const SLACK_LOOKUP_PAUSE_MS = 200;
const SLACK_SEND_PAUSE_MS = 300;

/**
 * Один прогон проверки: кто из отслеживаемых пользователей не репортился в Tempo
 * за последние N рабочих дней. Такому человеку уходит DM, а его менеджерам —
 * дайджест со списком подчинённых. Что именно рассылать, решает расписание;
 * ручной запуск делает и то, и другое.
 *
 * @param {{ trigger: 'schedule'|'manual', requestedBy?: string|null, now?: Date }} options
 */
export async function runReminderCheck({ trigger, requestedBy = null, now = new Date() }) {
  const startedAt = new Date(now).toISOString();
  const settings = await getSettings();
  // Праздник — не рабочий день: время за него не спрашивается, и планового прогона
  // в этот день нет. Выключенная галочка превращает календарь в справочный список.
  const isHoliday = settings.skipHolidays ? makeHolidayChecker(await getHolidays()) : () => null;

  // Плановый прогон ещё раз сверяется с расписанием: job мог пролежать в очереди
  // дольше, чем предполагалось при постановке. Ручной запуск расписанию не подчиняется.
  const schedule = trigger === 'schedule' ? await evaluateSchedule(settings, now, isHoliday) : null;
  if (schedule && !schedule.shouldRun) {
    return finish({ trigger, requestedBy, startedAt, status: 'skipped', message: schedule.reason });
  }

  const targets = schedule
    ? {
        users: schedule.due[RUN_KIND.users].length > 0,
        managers: schedule.due[RUN_KIND.managers].length > 0,
      }
    : { users: true, managers: true };

  const today = schedule?.date ?? dayParts(now).date;
  // Проверяем каждый рабочий день окна по отдельности, но за самые свежие дни
  // время ещё могут не успеть занести — их прощает «acceptable delay».
  let checkedDays;
  try {
    checkedDays = lastWorkingDays(today, settings.lookbackWorkingDays, isHoliday);
  } catch (e) {
    return finish({ trigger, requestedBy, startedAt, status: 'failed', message: e.message }, schedule);
  }
  const requiredDays = daysToReport(checkedDays, settings.acceptableDelayDays);
  const window = windowOf(checkedDays);
  // Настройки нормализуются на чтении и такого не допускают; проверка здесь на
  // случай, если правило «задержка меньше окна» когда-нибудь ослабнет.
  if (requiredDays.length === 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'skipped',
      message: 'The acceptable delay covers the whole window — there is nothing to check',
    }, schedule);
  }

  const users = await getTrackedUsers();
  if (users.length === 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'skipped',
      message: 'The tracked users list is empty — add users in the app settings',
    }, schedule);
  }

  const { tempoToken, slackBotToken } = await getCredentials();
  const missing = [
    !tempoToken && 'Tempo API token',
    !slackBotToken && 'Slack bot token',
  ].filter(Boolean);
  if (missing.length > 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'failed',
      message: `Missing tokens: ${missing.join(', ')} — set them in the app settings`,
    }, schedule);
  }

  console.log(
    `Прогон (${trigger}${schedule ? `, слоты ${describeDue(schedule.due)}` : ''}): ` +
      `окно ${window.from}..${window.to} (${checkedDays.length} раб. дн.), ` +
      `спрашиваем ${requiredDays.length}: ${requiredDays.join(', ')}; ` +
      `отслеживается ${users.length} чел., ` +
      `рассылка: ${[targets.users && 'сотрудникам', targets.managers && 'менеджерам'].filter(Boolean).join(' и ') || '—'}`
  );

  // Тянем из Tempo только спрашиваемые дни: за прощённые записи всё равно не
  // проверяются, а лишние страницы — это лишние запросы к шлюзу с rate limit'ом.
  const fetchRange = windowOf(requiredDays);
  let daysByAuthor;
  try {
    daysByAuthor = await getWorklogDaysByAuthor(fetchRange.from, fetchRange.to, tempoToken);
  } catch (e) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'failed',
      message: `Couldn’t fetch worklogs from Tempo: ${e.message}`,
    }, schedule);
  }
  console.log(`Tempo: ${daysByAuthor.size} авторов с записями в окне`);

  // Дни без записей у каждого отслеживаемого — считаем один раз: они нужны и для
  // самих напоминаний, и для списка в дайджесте менеджеру, и для отчёта.
  const missingDaysByUser = new Map(
    users.map((user) => {
      const reported = daysByAuthor.get(user.accountId) ?? new Set();
      return [user.accountId, requiredDays.filter((day) => !reported.has(day))];
    })
  );
  const unreported = users.filter((user) => missingDaysByUser.get(user.accountId).length > 0);

  const rows = targets.users
    ? await remindUsers({ users, missingDaysByUser, requiredDays, window, settings, slackBotToken })
    : [];
  const managerRows = targets.managers
    ? await notifyManagers({
        users,
        unreported,
        missingDaysByUser,
        window,
        settings,
        slackBotToken,
      })
    : [];

  const totals = countUserOutcomes(rows);
  // Если дайджесты в этот прогон не рассылались, счётчик «без менеджера» тоже
  // не считаем: иначе отчёт о рассылке сотрудникам предупреждал бы о менеджерах.
  const managerTotals = countManagerOutcomes(managerRows, targets.managers ? unreported : []);
  console.log(
    `Готово. Напоминаний: ${totals.reminded}, дайджестов: ${managerTotals.notified}, ` +
      `«всё в порядке»: ${managerTotals.allClear}, ошибок: ${totals.failed + managerTotals.failed}`
  );

  return finish({
    trigger,
    requestedBy,
    startedAt,
    window,
    requiredDays,
    status: 'ok',
    message: summarize(targets, totals, managerTotals, unreported.length),
    rows,
    totals,
    managerRows,
    managerTotals,
  }, schedule);
}

/**
 * Напоминания самим сотрудникам: по одному DM каждому, у кого хотя бы за один
 * спрашиваемый день нет записей в Tempo.
 */
async function remindUsers({
  users,
  missingDaysByUser,
  requiredDays,
  window,
  settings,
  slackBotToken,
}) {
  const rows = [];
  const slackIdsToCache = {};

  for (const user of users) {
    const missingDays = missingDaysByUser.get(user.accountId) ?? [];
    if (missingDays.length === 0) {
      rows.push(row(user, OUTCOME.logged, `Has entries for all ${requiredDays.length} checked days`));
      continue;
    }

    const text = renderUserMessage(settings.messageTemplate, {
      user,
      missingDays,
      window,
      lookbackWorkingDays: settings.lookbackWorkingDays,
    });
    const sent = await dm(user, text, slackBotToken, slackIdsToCache);
    const detail =
      sent.outcome === OUTCOME.reminded
        ? `Reminder sent, no entries for: ${formatDays(missingDays)}`
        : sent.detail;
    rows.push(row(user, sent.outcome, detail));
  }

  await cacheSlackUserIds(slackIdsToCache);
  return rows;
}

/**
 * Сообщения менеджерам: одно каждому из списка. Тем, у кого кто-то не отчитался,
 * уходит дайджест со списком таких подчинённых; остальным — отдельный текст о том,
 * что отчитались все. Молчание в этом случае неотличимо от сломавшейся рассылки,
 * поэтому пишем всем.
 */
async function notifyManagers({
  users,
  unreported,
  missingDaysByUser,
  window,
  settings,
  slackBotToken,
}) {
  const managers = await getManagers();
  if (managers.length === 0) return [];

  const withPeople = new Map(
    groupByManager(unreported, managers).map(({ manager, people }) => [manager.accountId, people])
  );
  const managedCounts = countManagedPeople(users);
  const rows = [];
  const slackIdsToCache = {};

  for (const manager of managers) {
    const people = withPeople.get(manager.accountId) ?? [];
    const isAllClear = people.length === 0;
    const managedCount = managedCounts.get(manager.accountId) ?? 0;

    const text = isAllClear
      ? renderManagerAllClearMessage(settings.managerAllClearTemplate, {
          manager,
          managedCount,
          window,
          lookbackWorkingDays: settings.lookbackWorkingDays,
        })
      : renderManagerMessage(settings.managerMessageTemplate, {
          manager,
          people,
          missingDaysByUser,
          window,
          lookbackWorkingDays: settings.lookbackWorkingDays,
        });

    const sent = await dm(manager, text, slackBotToken, slackIdsToCache);
    const delivered = sent.outcome === OUTCOME.reminded;
    const outcome = delivered ? (isAllClear ? OUTCOME.allClear : OUTCOME.notified) : sent.outcome;
    const detail = delivered ? describeSent(people, managedCount) : sent.detail;
    rows.push(managerRow(manager, people.length, outcome, detail));
  }

  await cacheManagerSlackUserIds(slackIdsToCache);
  return rows;
}

/**
 * Что именно ушло менеджеру — строкой для отчёта. Менеджер без единого закреплённого
 * сотрудника тоже получает «всё в порядке», и это стоит отметить: скорее всего его
 * просто забыли проставить кому-то в колонке Managers.
 */
function describeSent(people, managedCount) {
  if (people.length > 0) return `Digest sent about: ${people.map((p) => p.displayName).join(', ')}`;
  return managedCount > 0
    ? `All clear message sent: all ${managedCount} of their people have logged time`
    : 'All clear message sent, but nobody is assigned to this manager';
}

/**
 * Отправка одного DM: поиск человека в Slack по email (с кэшированием id) и сообщение.
 * Ошибка на одном получателе не роняет прогон — она превращается в строку отчёта.
 */
async function dm(person, text, slackBotToken, slackIdsToCache) {
  if (!person.email) {
    return {
      outcome: OUTCOME.noEmail,
      detail: 'No email — the Slack user can’t be found. Set the email manually in the settings',
    };
  }

  try {
    let slackUserId = person.slackUserId;
    if (!slackUserId) {
      slackUserId = await lookupSlackUserByEmail(person.email, slackBotToken);
      await sleep(SLACK_LOOKUP_PAUSE_MS);
      if (!slackUserId) {
        return { outcome: OUTCOME.noSlack, detail: `No Slack user with email ${person.email}` };
      }
      slackIdsToCache[person.accountId] = slackUserId;
    }

    await sendSlackDm(slackUserId, text, slackBotToken);
    await sleep(SLACK_SEND_PAUSE_MS);
    return { outcome: OUTCOME.reminded, detail: 'Reminder sent' };
  } catch (e) {
    console.error(`Ошибка для ${person.accountId}: ${e.message}`);
    return { outcome: OUTCOME.error, detail: e.message };
  }
}

/**
 * Пора ли запускать плановую проверку прямо сейчас — отдельно для каждой рассылки.
 *
 * Триггер будит функцию раз в час, а расписания задаются списками времён в настройках,
 * значит решение принимается здесь. Слот считается наступившим, если его время уже
 * прошло (но не больше чем на CATCH_UP_MINUTES) и он ещё не отработал в текущих сутках.
 *
 * Наступивших слотов может оказаться несколько — если триггер пропустил час. Прогон
 * при этом один, а закрываются все: два одинаковых сообщения подряд человеку не нужны.
 */
export async function evaluateSchedule(settings, now = new Date(), isHoliday = () => null) {
  const { date, minutes } = dayParts(now);
  const empty = { [RUN_KIND.users]: [], [RUN_KIND.managers]: [] };

  if (settings.runTimes.length === 0 && settings.managerRunTimes.length === 0) {
    return { shouldRun: false, date, due: empty, reason: 'No run times are configured — scheduled checks are off' };
  }
  const holiday = isHoliday(date);
  if (holiday) {
    return {
      shouldRun: false,
      date,
      due: empty,
      reason: `${holiday.name} — the scheduled run was skipped`,
    };
  }
  if (settings.skipWeekends && isWeekend(date)) {
    return { shouldRun: false, date, due: empty, reason: 'Weekend — the scheduled run was skipped' };
  }

  const due = {
    [RUN_KIND.users]: await dueFor(settings.runTimes, RUN_KIND.users, date, minutes),
    [RUN_KIND.managers]: await dueFor(settings.managerRunTimes, RUN_KIND.managers, date, minutes),
  };
  if (due[RUN_KIND.users].length === 0 && due[RUN_KIND.managers].length === 0) {
    return {
      shouldRun: false,
      date,
      due,
      reason: `It’s ${formatClock(minutes)} ${SCHEDULE_TIME_ZONE} — no run time is due, the scheduled run was skipped`,
    };
  }

  return { shouldRun: true, date, due, reason: null };
}

async function dueFor(runTimes, kind, date, nowMinutes) {
  if (runTimes.length === 0) return [];
  return dueRunTimes({
    runTimes,
    nowMinutes,
    handledTimes: await getHandledRunTimes(date, kind),
    catchUpMinutes: CATCH_UP_MINUTES,
  });
}

/**
 * Для страницы настроек: текущее время и ближайший запуск каждой из рассылок.
 */
export async function describeSchedule(settings, now = new Date()) {
  const { date, minutes } = dayParts(now);
  const isHoliday = settings.skipHolidays ? makeHolidayChecker(await getHolidays()) : () => null;
  const isSkippedDay = (day) =>
    (settings.skipWeekends && isWeekend(day)) || Boolean(isHoliday(day));

  const next = async (runTimes, kind) =>
    nextRunTime({
      runTimes,
      isSkippedDay,
      today: date,
      nowMinutes: minutes,
      handledTimes: await getHandledRunTimes(date, kind),
    });

  const [users, managers] = await Promise.all([
    next(settings.runTimes, RUN_KIND.users),
    next(settings.managerRunTimes, RUN_KIND.managers),
  ]);

  return {
    timeZone: SCHEDULE_TIME_ZONE,
    now: `${date} ${formatClock(minutes)}`,
    nextRun: users ? `${users.date} ${users.time}` : null,
    nextManagerRun: managers ? `${managers.date} ${managers.time}` : null,
    catchUpMinutes: CATCH_UP_MINUTES,
  };
}

/** Наступившие слоты одной строкой — для логов планового запуска. */
export function describeDue(due) {
  return (
    [
      due[RUN_KIND.users].length > 0 && `сотрудники ${due[RUN_KIND.users].join(', ')}`,
      due[RUN_KIND.managers].length > 0 && `менеджеры ${due[RUN_KIND.managers].join(', ')}`,
    ]
      .filter(Boolean)
      .join('; ') || '—'
  );
}

// Строку отчёта хранит KVS с лимитом на размер значения, поэтому длинный перечень
// дней в ней сокращается; полный список человек видит в самом сообщении.
const MAX_DAYS_IN_DETAIL = 5;

function formatDays(days) {
  if (days.length <= MAX_DAYS_IN_DETAIL) return days.join(', ');
  const shown = days.slice(0, MAX_DAYS_IN_DETAIL).join(', ');
  return `${shown} and ${days.length - MAX_DAYS_IN_DETAIL} more`;
}

function row(user, outcome, detail) {
  return {
    accountId: user.accountId,
    displayName: user.displayName,
    email: user.email ?? null,
    outcome,
    detail,
  };
}

function managerRow(manager, reportedCount, outcome, detail) {
  return { ...row(manager, outcome, detail), reportedCount };
}

function countUserOutcomes(rows) {
  const totals = { tracked: rows.length, logged: 0, reminded: 0, skipped: 0, failed: 0 };
  for (const { outcome } of rows) {
    if (outcome === OUTCOME.logged) totals.logged++;
    else if (outcome === OUTCOME.reminded) totals.reminded++;
    else if (outcome === OUTCOME.error) totals.failed++;
    else totals.skipped++;
  }
  return totals;
}

function countManagerOutcomes(rows, unreported) {
  const totals = {
    managers: rows.length,
    notified: 0,
    allClear: 0,
    failed: 0,
    skipped: 0,
    // Не отчитавшиеся, которым не назначен ни один менеджер: о них не узнает никто,
    // и это стоит видеть в отчёте, а не выяснять по факту тишины.
    withoutManager: countWithoutManager(unreported),
  };
  for (const { outcome } of rows) {
    if (outcome === OUTCOME.notified) totals.notified++;
    else if (outcome === OUTCOME.allClear) totals.allClear++;
    else if (outcome === OUTCOME.error) totals.failed++;
    else totals.skipped++;
  }
  return totals;
}

function summarize(targets, totals, managerTotals, unreportedCount) {
  const parts = [`${unreportedCount} of the tracked people are missing at least one checked day`];
  if (targets.users) parts.push(`reminders sent: ${totals.reminded}`);
  if (targets.managers) {
    parts.push(
      `manager digests sent: ${managerTotals.notified}, all-clear notes: ${managerTotals.allClear}`
    );
  }
  if (!targets.users && !targets.managers) parts.push('nothing was sent');
  return parts.join(', ');
}

async function finish(report, schedule = null) {
  const full = {
    rows: [],
    totals: { tracked: 0, logged: 0, reminded: 0, skipped: 0, failed: 0 },
    managerRows: [],
    managerTotals: { managers: 0, notified: 0, allClear: 0, failed: 0, skipped: 0, withoutManager: 0 },
    window: null,
    // Дни, за которые время уже обязано быть залогировано — окно минус допустимая задержка.
    requiredDays: [],
    ...report,
    finishedAt: new Date().toISOString(),
  };
  const saved = await saveLastReport(full);

  // Слоты закрываются только после успеха: если Tempo или Slack не ответили,
  // слот остаётся наступившим и следующее часовое срабатывание повторит попытку
  // — но лишь пока не вышло окно CATCH_UP_MINUTES.
  if (full.status === 'ok' && schedule) {
    for (const kind of Object.values(RUN_KIND)) {
      if (schedule.due[kind].length > 0) await markRunTimesHandled(schedule.date, kind, schedule.due[kind]);
    }
  }

  await setRunStatus({ state: 'idle', lastTrigger: full.trigger, lastStatus: full.status });
  if (full.status !== 'ok') console.log(`Прогон завершён со статусом ${full.status}: ${full.message}`);
  return saved;
}
