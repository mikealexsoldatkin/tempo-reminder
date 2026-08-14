import { kvs } from '@forge/kvs';
import { MAX_RUN_TIMES, parseRunTimes } from './schedule.js';

/**
 * Всё состояние приложения живёт в Forge KVS (app storage), env-переменные не используются:
 *  - обычные ключи: настройки, список отслеживаемых пользователей, статус и отчёты о прогонах;
 *  - секретные ключи (setSecret/getSecret): токены Tempo и Slack — наружу не отдаются никогда.
 */
const KEY = {
  settings: 'settings',
  trackedUsers: 'tracked-users',
  credentialsMeta: 'credentials-meta',
  runStatus: 'run-status',
  lastReport: 'last-run-report',
  scheduleState: 'schedule-state',
};

const SECRET_KEY = {
  tempoToken: 'tempo-token',
  slackBotToken: 'slack-bot-token',
};

export const CREDENTIAL_NAMES = Object.keys(SECRET_KEY);

export const DEFAULT_SETTINGS = {
  // Сколько рабочих дней назад смотрим (окно [from..today]).
  lookbackWorkingDays: 2,
  // В какие моменты суток (UTC) запускать проверку — отсортированный список 'HH:MM'.
  // Пустой список означает, что по расписанию проверка не запускается вообще.
  runTimes: ['09:00'],
  // Пропускать ли запуск по расписанию в субботу/воскресенье.
  skipWeekends: true,
  // Плейсхолдеры: {from}, {to}, {days}, {name}.
  messageTemplate:
    ':clock3: Hi {name}! It looks like Tempo has no time entries from you for the last {days} working days ({from} — {to}). Please take a moment to log your time 🙏',
};

/* ---------------------------- настройки ---------------------------- */

export async function getSettings() {
  const stored = (await kvs.get(KEY.settings)) ?? {};
  // Нормализуем и на чтении: так наружу не протекают поля, оставшиеся от прежних
  // версий настроек, а битое значение в KVS не роняет страницу.
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

export async function saveSettings(patch) {
  const incoming = patch ?? {};
  validateSettingsPatch(incoming);
  const next = normalizeSettings({ ...(await getSettings()), ...incoming });
  await kvs.set(KEY.settings, next);
  return next;
}

/**
 * Ругаемся на то, что администратор ввёл руками: молча подставить дефолт вместо
 * непонятого времени хуже, чем показать ошибку в форме.
 */
function validateSettingsPatch(patch) {
  if (patch.runTimes === undefined) return;

  const { times, invalid } = parseRunTimes(patch.runTimes);
  if (invalid.length > 0) {
    throw new Error(`Couldn’t read the run times: ${invalid.join(', ')}. Use HH:MM separated by commas.`);
  }
  if (times.length > MAX_RUN_TIMES) {
    throw new Error(`No more than ${MAX_RUN_TIMES} run times, got ${times.length}.`);
  }
}

function normalizeSettings(settings) {
  const lookback = Number(settings.lookbackWorkingDays);
  return {
    lookbackWorkingDays: Number.isFinite(lookback) ? Math.min(Math.max(Math.trunc(lookback), 1), 30) : DEFAULT_SETTINGS.lookbackWorkingDays,
    runTimes: parseRunTimes(settings.runTimes).times.slice(0, MAX_RUN_TIMES),
    skipWeekends: Boolean(settings.skipWeekends),
    messageTemplate: String(settings.messageTemplate || DEFAULT_SETTINGS.messageTemplate).slice(0, 1000),
  };
}

/* --------------------- отслеживаемые пользователи --------------------- */

export async function getTrackedUsers() {
  const stored = (await kvs.get(KEY.trackedUsers)) ?? [];
  return Array.isArray(stored) ? stored : [];
}

/**
 * Добавляет пользователей, игнорируя уже добавленных (ключ — accountId).
 */
export async function addTrackedUsers(candidates) {
  const current = await getTrackedUsers();
  const byId = new Map(current.map((u) => [u.accountId, u]));
  const addedAt = new Date().toISOString();
  let added = 0;

  for (const candidate of candidates) {
    if (!candidate?.accountId) continue;
    const existing = byId.get(candidate.accountId);
    if (existing) {
      // Обновляем то, что могло измениться в Jira, но не теряем ручной email.
      existing.displayName = candidate.displayName || existing.displayName;
      if (!existing.email && candidate.email) existing.email = candidate.email;
      continue;
    }
    byId.set(candidate.accountId, {
      accountId: candidate.accountId,
      displayName: candidate.displayName || candidate.accountId,
      email: candidate.email || null,
      emailSource: candidate.email ? 'jira' : null,
      slackUserId: null,
      addedAt,
    });
    added++;
  }

  const next = sortUsers([...byId.values()]);
  await kvs.set(KEY.trackedUsers, next);
  return { users: next, added, skipped: candidates.length - added };
}

export async function removeTrackedUsers(accountIds) {
  const drop = new Set(accountIds ?? []);
  const next = (await getTrackedUsers()).filter((u) => !drop.has(u.accountId));
  await kvs.set(KEY.trackedUsers, next);
  return next;
}

export async function setTrackedUserEmail(accountId, email) {
  const users = await getTrackedUsers();
  const user = users.find((u) => u.accountId === accountId);
  if (!user) throw new Error(`User ${accountId} is not tracked`);
  user.email = email ? String(email).trim() : null;
  user.emailSource = user.email ? 'manual' : null;
  user.slackUserId = null; // email поменялся — кэш Slack-id больше не валиден
  await kvs.set(KEY.trackedUsers, users);
  return users;
}

/**
 * Кэширует найденные Slack-id, чтобы не звать users.lookupByEmail на каждом прогоне.
 */
export async function cacheSlackUserIds(idsByAccountId) {
  const entries = Object.entries(idsByAccountId);
  if (entries.length === 0) return;
  const users = await getTrackedUsers();
  let changed = false;
  for (const [accountId, slackUserId] of entries) {
    const user = users.find((u) => u.accountId === accountId);
    if (user && user.slackUserId !== slackUserId) {
      user.slackUserId = slackUserId;
      changed = true;
    }
  }
  if (changed) await kvs.set(KEY.trackedUsers, users);
}

function sortUsers(users) {
  return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/* ------------------------------ секреты ------------------------------ */

export async function getCredentials() {
  const [tempoToken, slackBotToken] = await Promise.all([
    kvs.getSecret(SECRET_KEY.tempoToken),
    kvs.getSecret(SECRET_KEY.slackBotToken),
  ]);
  return { tempoToken: tempoToken ?? null, slackBotToken: slackBotToken ?? null };
}

/**
 * Статус для UI: сам токен не отдаём, только «задан / не задан», хвост и время обновления.
 */
export async function getCredentialsStatus() {
  const [{ tempoToken, slackBotToken }, meta] = await Promise.all([
    getCredentials(),
    kvs.get(KEY.credentialsMeta).then((v) => v ?? {}),
  ]);
  return {
    tempoToken: describeCredential(tempoToken, meta.tempoToken),
    slackBotToken: describeCredential(slackBotToken, meta.slackBotToken),
  };
}

function describeCredential(value, meta) {
  return {
    isSet: Boolean(value),
    maskedTail: value ? `…${String(value).slice(-4)}` : null,
    updatedAt: meta?.updatedAt ?? null,
  };
}

export async function saveCredential(name, value) {
  const secretKey = SECRET_KEY[name];
  if (!secretKey) throw new Error(`Unknown token: ${name}`);
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error('Token value is empty');

  await kvs.setSecret(secretKey, trimmed);
  const meta = (await kvs.get(KEY.credentialsMeta)) ?? {};
  meta[name] = { updatedAt: new Date().toISOString() };
  await kvs.set(KEY.credentialsMeta, meta);
}

export async function clearCredential(name) {
  const secretKey = SECRET_KEY[name];
  if (!secretKey) throw new Error(`Unknown token: ${name}`);
  await kvs.deleteSecret(secretKey);
  const meta = (await kvs.get(KEY.credentialsMeta)) ?? {};
  delete meta[name];
  await kvs.set(KEY.credentialsMeta, meta);
}

/* --------------------------- статус прогона --------------------------- */

const STALE_RUN_MS = 20 * 60 * 1000; // консьюмер живёт максимум 15 минут

export async function getRunStatus() {
  const status = (await kvs.get(KEY.runStatus)) ?? { state: 'idle' };
  if ((status.state === 'queued' || status.state === 'running') && isStale(status.updatedAt)) {
    return { ...status, state: 'stale' };
  }
  return status;
}

function isStale(updatedAt) {
  const ts = Date.parse(updatedAt ?? '');
  return !Number.isFinite(ts) || Date.now() - ts > STALE_RUN_MS;
}

export async function setRunStatus(status) {
  const next = { ...status, updatedAt: new Date().toISOString() };
  await kvs.set(KEY.runStatus, next);
  return next;
}

/**
 * Слоты расписания, уже отработавшие в текущих сутках (UTC) — отдельным ключом,
 * чтобы ручные прогоны, перетирающие отчёт, не сбивали расписание.
 *
 * Хранится ровно одна дата: как только наступают новые сутки, прежний список
 * перестаёт быть актуальным и просто игнорируется.
 */
export async function getHandledRunTimes(date) {
  const state = (await kvs.get(KEY.scheduleState)) ?? {};
  return state.date === date ? state.handledTimes ?? [] : [];
}

export async function markRunTimesHandled(date, times) {
  const already = await getHandledRunTimes(date);
  await kvs.set(KEY.scheduleState, {
    date,
    handledTimes: [...new Set([...already, ...times])].sort(),
  });
}

export async function getLastReport() {
  return (await kvs.get(KEY.lastReport)) ?? null;
}

// Значение в KVS ограничено по размеру, поэтому длинные отчёты обрезаем.
const MAX_REPORT_ROWS = 300;

// Что важнее увидеть в UI, если строк больше лимита.
const ROW_PRIORITY = { error: 0, 'no-slack': 1, 'no-email': 1, reminded: 2, logged: 3 };

export async function saveLastReport(report) {
  const rows = [...(report.rows ?? [])].sort(
    (a, b) => (ROW_PRIORITY[a.outcome] ?? 9) - (ROW_PRIORITY[b.outcome] ?? 9)
  );
  const stored = {
    ...report,
    rows: rows.slice(0, MAX_REPORT_ROWS),
    truncatedRows: Math.max(rows.length - MAX_REPORT_ROWS, 0),
  };
  await kvs.set(KEY.lastReport, stored);
  return stored;
}
