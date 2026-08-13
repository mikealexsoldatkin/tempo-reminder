import {
  cacheSlackUserIds,
  getCredentials,
  getLastScheduledOkDate,
  getSettings,
  getTrackedUsers,
  markScheduledRunOk,
  saveLastReport,
  setRunStatus,
} from './store.js';
import { getWorklogAuthors, sleep } from './tempo.js';
import { lookupSlackUserByEmail, sendSlackDm } from './slack.js';
import { isWeekend, isoDate, workingDayWindow } from './workdays.js';

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

  const skipReason = await resolveSkipReason(trigger, settings, now);
  if (skipReason) {
    return finish({ trigger, requestedBy, startedAt, status: 'skipped', message: skipReason });
  }

  const window = workingDayWindow(now, settings.lookbackWorkingDays);
  const users = await getTrackedUsers();
  if (users.length === 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'skipped',
      message: 'The tracked users list is empty — add users in the app settings',
    });
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
    });
  }

  console.log(`Прогон (${trigger}): окно ${window.from}..${window.to}, отслеживается ${users.length} чел.`);

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
    });
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
  });
}

/**
 * Причина не запускаться: выходной или сегодня уже был плановый прогон.
 * Ручной запуск из настроек не ограничиваем — он всегда выполняется.
 */
export async function resolveSkipReason(trigger, settings, now) {
  if (trigger !== 'schedule') return null;

  if (settings.skipWeekends && isWeekend(now)) return 'Weekend — the scheduled run was skipped';

  if (settings.oncePerDay && (await getLastScheduledOkDate()) === isoDate(now)) {
    return 'The scheduled run already completed today — the repeat was skipped';
  }
  return null;
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

async function finish(report) {
  const full = {
    rows: [],
    totals: { tracked: 0, logged: 0, reminded: 0, skipped: 0, failed: 0 },
    window: null,
    ...report,
    finishedAt: new Date().toISOString(),
  };
  const saved = await saveLastReport(full);
  if (full.trigger === 'schedule' && full.status === 'ok') {
    await markScheduledRunOk(full.startedAt.slice(0, 10));
  }
  await setRunStatus({ state: 'idle', lastTrigger: full.trigger, lastStatus: full.status });
  if (full.status !== 'ok') console.log(`Прогон завершён со статусом ${full.status}: ${full.message}`);
  return saved;
}
