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
  managers: 'managers',
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
  // В какие моменты суток (UTC) слать напоминания самим сотрудникам —
  // отсортированный список 'HH:MM'. Пустой список выключает эту рассылку.
  runTimes: ['09:00'],
  // Отдельное расписание для дайджестов менеджерам. По умолчанию пусто: пока
  // менеджеры не назначены, рассылать им нечего.
  managerRunTimes: [],
  // Пропускать ли запуск по расписанию в субботу/воскресенье.
  skipWeekends: true,
  // Плейсхолдеры: {from}, {to}, {days}, {name}.
  messageTemplate:
    ':clock3: Hi {name}! It looks like Tempo has no time entries from you for the last {days} working days ({from} — {to}). Please take a moment to log your time 🙏',
  // То же плюс {count} — сколько подчинённых не отчиталось — и {list} — их имена
  // построчно.
  managerMessageTemplate:
    ':bar_chart: Hi {name}! {count} of the people you manage have no time entries in Tempo for the last {days} working days ({from} — {to}):\n{list}',
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
  for (const [field, label] of [
    ['runTimes', 'run times'],
    ['managerRunTimes', 'manager run times'],
  ]) {
    if (patch[field] === undefined) continue;

    const { times, invalid } = parseRunTimes(patch[field]);
    if (invalid.length > 0) {
      throw new Error(`Couldn’t read the ${label}: ${invalid.join(', ')}. Use HH:MM separated by commas.`);
    }
    if (times.length > MAX_RUN_TIMES) {
      throw new Error(`No more than ${MAX_RUN_TIMES} ${label}, got ${times.length}.`);
    }
  }
}

function normalizeSettings(settings) {
  const lookback = Number(settings.lookbackWorkingDays);
  return {
    lookbackWorkingDays: Number.isFinite(lookback) ? Math.min(Math.max(Math.trunc(lookback), 1), 30) : DEFAULT_SETTINGS.lookbackWorkingDays,
    runTimes: parseRunTimes(settings.runTimes).times.slice(0, MAX_RUN_TIMES),
    managerRunTimes: parseRunTimes(settings.managerRunTimes).times.slice(0, MAX_RUN_TIMES),
    skipWeekends: Boolean(settings.skipWeekends),
    messageTemplate: String(settings.messageTemplate || DEFAULT_SETTINGS.messageTemplate).slice(0, 1000),
    managerMessageTemplate: String(
      settings.managerMessageTemplate || DEFAULT_SETTINGS.managerMessageTemplate
    ).slice(0, 1000),
  };
}

/* ------------------------------ списки людей ------------------------------ */

/**
 * Отслеживаемые пользователи и менеджеры — два независимых списка людей из Jira
 * с одинаковой механикой: добавление батчем без дублей, удаление, ручная правка
 * email (он нужен для поиска в Slack) и кэш найденного Slack-id. Различаются
 * списки только дополнительными полями записи, поэтому общая часть — здесь.
 *
 * @param {string} storageKey ключ в KVS
 * @param {{ onCreate?: () => object, normalize?: (person: object) => object }} hooks
 */
function peopleList(storageKey, { onCreate = () => ({}), normalize = (person) => person } = {}) {
  const read = async () => {
    const stored = (await kvs.get(storageKey)) ?? [];
    return Array.isArray(stored) ? stored.map(normalize) : [];
  };

  const write = async (people) => {
    const next = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
    await kvs.set(storageKey, next);
    return next;
  };

  const add = async (candidates) => {
    const byId = new Map((await read()).map((person) => [person.accountId, person]));
    const addedAt = new Date().toISOString();
    let added = 0;

    for (const candidate of candidates ?? []) {
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
        ...onCreate(),
      });
      added++;
    }

    const people = await write([...byId.values()]);
    return { people, added, skipped: (candidates ?? []).length - added };
  };

  const remove = async (accountIds) => {
    const drop = new Set(accountIds ?? []);
    return write((await read()).filter((person) => !drop.has(person.accountId)));
  };

  const setEmail = async (accountId, email) => {
    const people = await read();
    const person = people.find((p) => p.accountId === accountId);
    if (!person) throw new Error(`${accountId} is not in the list`);
    person.email = email ? String(email).trim() : null;
    person.emailSource = person.email ? 'manual' : null;
    person.slackUserId = null; // email поменялся — кэш Slack-id больше не валиден
    return write(people);
  };

  /** Кэширует найденные Slack-id, чтобы не звать users.lookupByEmail на каждом прогоне. */
  const cacheSlackIds = async (idsByAccountId) => {
    const entries = Object.entries(idsByAccountId ?? {});
    if (entries.length === 0) return;
    const people = await read();
    let changed = false;
    for (const [accountId, slackUserId] of entries) {
      const person = people.find((p) => p.accountId === accountId);
      if (person && person.slackUserId !== slackUserId) {
        person.slackUserId = slackUserId;
        changed = true;
      }
    }
    if (changed) await write(people);
  };

  return { read, write, add, remove, setEmail, cacheSlackIds };
}

// managerIds появилось позже самих записей, поэтому подставляем пустой список на чтении.
const trackedUsers = peopleList(KEY.trackedUsers, {
  onCreate: () => ({ managerIds: [] }),
  normalize: (user) => ({ ...user, managerIds: user.managerIds ?? [] }),
});

const managers = peopleList(KEY.managers);

/* --------------------- отслеживаемые пользователи --------------------- */

export const getTrackedUsers = () => trackedUsers.read();
export const addTrackedUsers = async (candidates) => {
  const { people, added, skipped } = await trackedUsers.add(candidates);
  return { users: people, added, skipped };
};
export const removeTrackedUsers = (accountIds) => trackedUsers.remove(accountIds);
export const setTrackedUserEmail = (accountId, email) => trackedUsers.setEmail(accountId, email);
export const cacheSlackUserIds = (idsByAccountId) => trackedUsers.cacheSlackIds(idsByAccountId);

/**
 * Назначает пользователю менеджеров. Принимаем только тех, кто есть в списке
 * менеджеров: иначе в записи копились бы ссылки на давно удалённых людей.
 */
export async function setTrackedUserManagers(accountId, managerIds) {
  const known = new Set((await managers.read()).map((m) => m.accountId));
  const users = await trackedUsers.read();
  const user = users.find((u) => u.accountId === accountId);
  if (!user) throw new Error(`User ${accountId} is not tracked`);

  user.managerIds = [...new Set(managerIds ?? [])].filter((id) => known.has(id));
  return trackedUsers.write(users);
}

/* ------------------------------ менеджеры ------------------------------ */

export const getManagers = () => managers.read();
export const addManagers = async (candidates) => {
  const { people, added, skipped } = await managers.add(candidates);
  return { managers: people, added, skipped };
};
export const setManagerEmail = (accountId, email) => managers.setEmail(accountId, email);
export const cacheManagerSlackUserIds = (idsByAccountId) => managers.cacheSlackIds(idsByAccountId);

/**
 * Удаление менеджера снимает его и со всех подчинённых: висящая ссылка на
 * удалённого человека молча выключила бы дайджест для этих сотрудников.
 */
export async function removeManagers(accountIds) {
  const drop = new Set(accountIds ?? []);
  const next = await managers.remove(accountIds);

  const users = await trackedUsers.read();
  let changed = false;
  for (const user of users) {
    const kept = user.managerIds.filter((id) => !drop.has(id));
    if (kept.length !== user.managerIds.length) {
      user.managerIds = kept;
      changed = true;
    }
  }
  if (changed) await trackedUsers.write(users);

  return { managers: next, users: changed ? await trackedUsers.read() : users };
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
 * Считаются раздельно для двух рассылок ('users' и 'managers'): у них свои
 * времена, и успех одной не должен закрывать слот другой. Хранится ровно одна
 * дата — как только наступают новые сутки, прежние списки просто игнорируются.
 */
export async function getHandledRunTimes(date, kind) {
  const state = (await kvs.get(KEY.scheduleState)) ?? {};
  return state.date === date ? state.handled?.[kind] ?? [] : [];
}

export async function markRunTimesHandled(date, kind, times) {
  const state = (await kvs.get(KEY.scheduleState)) ?? {};
  const handled = state.date === date ? { ...state.handled } : {};
  handled[kind] = [...new Set([...(handled[kind] ?? []), ...times])].sort();
  await kvs.set(KEY.scheduleState, { date, handled });
}

export async function getLastReport() {
  return (await kvs.get(KEY.lastReport)) ?? null;
}

// Значение в KVS ограничено по размеру, поэтому длинные отчёты обрезаем.
const MAX_REPORT_ROWS = 300;
// Менеджеров всегда на порядок меньше — им хватает лимита поменьше.
const MAX_MANAGER_ROWS = 100;

// Что важнее увидеть в UI, если строк больше лимита.
const ROW_PRIORITY = {
  error: 0,
  'no-slack': 1,
  'no-email': 1,
  reminded: 2,
  notified: 2,
  logged: 3,
  'nothing-to-report': 3,
};

function trimRows(rows, limit) {
  const sorted = [...(rows ?? [])].sort(
    (a, b) => (ROW_PRIORITY[a.outcome] ?? 9) - (ROW_PRIORITY[b.outcome] ?? 9)
  );
  return { rows: sorted.slice(0, limit), truncated: Math.max(sorted.length - limit, 0) };
}

export async function saveLastReport(report) {
  const users = trimRows(report.rows, MAX_REPORT_ROWS);
  const managerDigests = trimRows(report.managerRows, MAX_MANAGER_ROWS);
  const stored = {
    ...report,
    rows: users.rows,
    truncatedRows: users.truncated,
    managerRows: managerDigests.rows,
    truncatedManagerRows: managerDigests.truncated,
  };
  await kvs.set(KEY.lastReport, stored);
  return stored;
}
