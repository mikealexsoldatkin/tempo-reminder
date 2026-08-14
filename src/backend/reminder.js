import {
  cacheSlackUserIds,
  getCredentials,
  getHandledRunTimes,
  getSettings,
  getTrackedUsers,
  markRunTimesHandled,
  saveLastReport,
  setRunStatus,
} from './store.js';
import { getWorklogAuthors, sleep } from './tempo.js';
import { lookupSlackUserByEmail, sendSlackDm } from './slack.js';
import { isWeekend, workingDayWindow } from './workdays.js';
import {
  CATCH_UP_MINUTES,
  SCHEDULE_TIME_ZONE,
  dayParts,
  dueRunTimes,
  formatClock,
  nextRunTime,
} from './schedule.js';

export const OUTCOME = {
  reminded: 'reminded',
  logged: 'logged',
  noEmail: 'no-email',
  noSlack: 'no-slack',
  error: 'error',
};

// Паузы, чтобы не упереться в rate limit Slack (lookupByEmail — Tier 3, postMessage — ~1 msg/s).
const SLACK_LOOKUP_PAUSE_MS = 200;
const SLACK_SEND_PAUSE_MS = 300;

/**
 * Один прогон проверки: кто из отслеживаемых пользователей не репортился в Tempo
 * за последние N рабочих дней — тому DM в Slack.
 *
 * @param {{ trigger: 'schedule'|'manual', requestedBy?: string|null, now?: Date }} options
 */
export async function runReminderCheck({ trigger, requestedBy = null, now = new Date() }) {
  const startedAt = new Date(now).toISOString();
  const settings = await getSettings();

  // Плановый прогон ещё раз сверяется с расписанием: job мог пролежать в очереди
  // дольше, чем предполагалось при постановке. Ручной запуск расписанию не подчиняется.
  const schedule = trigger === 'schedule' ? await evaluateSchedule(settings, now) : null;
  if (schedule && !schedule.shouldRun) {
    return finish({ trigger, requestedBy, startedAt, status: 'skipped', message: schedule.reason });
  }

  const today = schedule?.date ?? dayParts(now).date;
  const window = workingDayWindow(today, settings.lookbackWorkingDays);
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
    `Прогон (${trigger}${schedule ? `, слоты ${schedule.dueTimes.join(', ')}` : ''}): ` +
      `окно ${window.from}..${window.to}, отслеживается ${users.length} чел.`
  );

  let authorsWithWorklogs;
  try {
    authorsWithWorklogs = await getWorklogAuthors(window.from, window.to, tempoToken);
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
  console.log(`Tempo: ${authorsWithWorklogs.size} авторов с записями в окне`);

  const rows = [];
  const slackIdsToCache = {};

  for (const user of users) {
    if (authorsWithWorklogs.has(user.accountId)) {
      rows.push(row(user, OUTCOME.logged, 'Has entries in Tempo'));
      continue;
    }

    if (!user.email) {
      rows.push(row(user, OUTCOME.noEmail, 'No email — the Slack user can’t be found. Set the email manually in the settings'));
      continue;
    }

    try {
      let slackUserId = user.slackUserId;
      if (!slackUserId) {
        slackUserId = await lookupSlackUserByEmail(user.email, slackBotToken);
        await sleep(SLACK_LOOKUP_PAUSE_MS);
        if (!slackUserId) {
          rows.push(row(user, OUTCOME.noSlack, `No Slack user with email ${user.email}`));
          continue;
        }
        slackIdsToCache[user.accountId] = slackUserId;
      }

      await sendSlackDm(slackUserId, renderMessage(settings.messageTemplate, user, window, settings), slackBotToken);
      await sleep(SLACK_SEND_PAUSE_MS);
      rows.push(row(user, OUTCOME.reminded, 'Reminder sent'));
    } catch (e) {
      console.error(`Ошибка для ${user.accountId}: ${e.message}`);
      rows.push(row(user, OUTCOME.error, e.message));
    }
  }

  await cacheSlackUserIds(slackIdsToCache);

  const totals = countOutcomes(rows);
  console.log(`Готово. Отправлено: ${totals.reminded}, ошибок: ${totals.failed}`);

  return finish({
    trigger,
    requestedBy,
    startedAt,
    window,
    status: 'ok',
    message: `Checked ${rows.length} people, reminders sent: ${totals.reminded}`,
    rows,
    totals,
  }, schedule);
}

/**
 * Пора ли запускать плановую проверку прямо сейчас.
 *
 * Триггер будит функцию раз в час, а расписание задаётся списком времён в настройках —
 * значит решение принимается здесь. Слот считается наступившим, если его время уже
 * прошло (но не больше чем на CATCH_UP_MINUTES) и он ещё не отработал в текущих сутках.
 *
 * Наступивших слотов может оказаться несколько — если триггер пропустил час. Прогон
 * при этом один, а закрываются все: два одинаковых сообщения подряд человеку не нужны.
 */
export async function evaluateSchedule(settings, now = new Date()) {
  const { date, minutes } = dayParts(now);
  const idle = (reason) => ({ shouldRun: false, date, dueTimes: [], reason });

  if (settings.runTimes.length === 0) {
    return idle('No run times are configured — scheduled checks are off');
  }
  if (settings.skipWeekends && isWeekend(date)) {
    return idle('Weekend — the scheduled run was skipped');
  }

  const dueTimes = dueRunTimes({
    runTimes: settings.runTimes,
    nowMinutes: minutes,
    handledTimes: await getHandledRunTimes(date),
    catchUpMinutes: CATCH_UP_MINUTES,
  });
  if (dueTimes.length === 0) {
    return idle(
      `It’s ${formatClock(minutes)} ${SCHEDULE_TIME_ZONE} — no run time is due, the scheduled run was skipped`
    );
  }

  return { shouldRun: true, date, dueTimes, reason: null };
}

/**
 * Для страницы настроек: текущее время и ближайший запланированный запуск.
 */
export async function describeSchedule(settings, now = new Date()) {
  const { date, minutes } = dayParts(now);
  const next = nextRunTime({
    runTimes: settings.runTimes,
    skipWeekends: settings.skipWeekends,
    today: date,
    nowMinutes: minutes,
    handledTimes: await getHandledRunTimes(date),
  });

  return {
    timeZone: SCHEDULE_TIME_ZONE,
    now: `${date} ${formatClock(minutes)}`,
    nextRun: next ? `${next.date} ${next.time}` : null,
    catchUpMinutes: CATCH_UP_MINUTES,
  };
}

function renderMessage(template, user, window, settings) {
  const firstName = user.displayName.split(' ')[0];
  return template
    .replaceAll('{name}', firstName)
    .replaceAll('{from}', window.from)
    .replaceAll('{to}', window.to)
    .replaceAll('{days}', String(settings.lookbackWorkingDays));
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

function countOutcomes(rows) {
  const totals = { tracked: rows.length, logged: 0, reminded: 0, skipped: 0, failed: 0 };
  for (const { outcome } of rows) {
    if (outcome === OUTCOME.logged) totals.logged++;
    else if (outcome === OUTCOME.reminded) totals.reminded++;
    else if (outcome === OUTCOME.error) totals.failed++;
    else totals.skipped++;
  }
  return totals;
}

async function finish(report, schedule = null) {
  const full = {
    rows: [],
    totals: { tracked: 0, logged: 0, reminded: 0, skipped: 0, failed: 0 },
    window: null,
    ...report,
    finishedAt: new Date().toISOString(),
  };
  const saved = await saveLastReport(full);
  // Слоты закрываются только после успеха: если Tempo или Slack не ответили,
  // слот остаётся наступившим и следующее часовое срабатывание повторит попытку
  // — но лишь пока не вышло окно CATCH_UP_MINUTES.
  if (full.status === 'ok' && schedule?.dueTimes?.length) {
    await markRunTimesHandled(schedule.date, schedule.dueTimes);
  }
  await setRunStatus({ state: 'idle', lastTrigger: full.trigger, lastStatus: full.status });
  if (full.status !== 'ok') console.log(`Прогон завершён со статусом ${full.status}: ${full.message}`);
  return saved;
}
