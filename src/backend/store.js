import { kvs } from '@forge/kvs';
import { MAX_RUN_TIMES, parseRunTimes } from './schedule.js';
import { DEFAULT_HOLIDAYS, holidayDate, normalizeHoliday } from './holidays.js';

/**
 * Всё состояние приложения живёт в Forge KVS (app storage), env-переменные не используются:
 *  - обычные ключи: настройки, список отслеживаемых пользователей, статус и отчёты о прогонах;
 *  - секретные ключи (setSecret/getSecret): токены Tempo и Slack — наружу не отдаются никогда.
 */
const KEY = {
  settings: 'settings',
  trackedUsers: 'tracked-users',
  detailedUsers: 'detailed-users',
  managers: 'managers',
  credentialsMeta: 'credentials-meta',
  runStatus: 'run-status',
  lastReport: 'last-run-report',
  scheduleState: 'schedule-state',
  holidays: 'holidays',
};

const SECRET_KEY = {
  tempoToken: 'tempo-token',
  slackBotToken: 'slack-bot-token',
  // «Secret address in iCal format» календаря отпусков: ссылка сама себе пароль,
  // поэтому хранится там же, где токены, и наружу не отдаётся.
  vacationIcsUrl: 'vacation-ics-url',
};

export const CREDENTIAL_NAMES = Object.keys(SECRET_KEY);

export const DEFAULT_SETTINGS = {
  // Сколько последних рабочих дней проверяем — время должно быть залогировано
  // за каждый из них по отдельности, а не «хоть за какой-нибудь».
  lookbackWorkingDays: 5,
  // Сколько самых свежих рабочих дней окна прощаем: время за них ещё могут не
  // успеть занести. 1 — сегодняшний день не спрашиваем.
  acceptableDelayDays: 1,
  // В какие моменты суток (UTC) слать напоминания самим сотрудникам —
  // отсортированный список 'HH:MM'. Пустой список выключает эту рассылку.
  runTimes: ['09:00'],
  // Отдельное расписание для дайджестов менеджерам. По умолчанию пусто: пока
  // менеджеры не назначены, рассылать им нечего.
  managerRunTimes: [],
  // Пропускать ли запуск по расписанию в субботу/воскресенье.
  skipWeekends: true,
  // Учитывать ли календарь праздников: праздник не считается рабочим днём (время
  // за него не спрашивается) и планового прогона в этот день не будет.
  skipHolidays: true,
  // Учитывать ли корпоративный календарь отпусков. По умолчанию выключено: пока
  // ссылка на календарь не задана, включать нечего.
  skipVacations: false,
  // Не писать сотруднику, пока он в отпуске, даже если за более старые дни окна
  // у него действительно нет записей: напомним, когда выйдет. Менеджеру такой
  // человек в дайджест всё равно попадёт.
  skipDmWhileOnLeave: false,
  // Плейсхолдеры: {from}, {to}, {days}, {name}, {missing} — пропущенные дни
  // перечислением и {missingCount} — сколько их.
  messageTemplate:
    ':clock3: Hi {name}! Tempo has no time entries from you for {missingCount} of the last {days} working days: {missing}. Please take a moment to log your time 🙏',
  // То же плюс {count} — сколько подчинённых не отчиталось — и {list} — их имена
  // построчно, каждое со своими пропущенными днями.
  managerMessageTemplate:
    ':bar_chart: Hi {name}! {count} of the people you manage have days with no time entries in Tempo among the last {days} working days ({from} — {to}):\n{list}',
  // Уходит менеджеру, у которого отчитались все: рассылка идёт по всему списку
  // менеджеров, и молчание в этом случае неотличимо от сломавшегося приложения.
  // Плейсхолдеры: {from}, {to}, {days}, {name} и {count} — размер команды.
  managerAllClearTemplate:
    ':white_check_mark: Hi {name}! Everyone you manage has logged their time in Tempo for every one of the last {days} working days ({from} — {to}). Nothing to chase 🎉',
  // Детальный отчёт по одному сотруднику из списка Detailed tracking users.
  // Плейсхолдеры: {name} — имя менеджера-получателя, {user} — чей это отчёт,
  // {from}, {to}, {days} и {report} — сам разбор по дням.
  detailedReportTemplate:
    ':mag: Hi {name}! Here is what {user} logged in Tempo over the last {days} working days ({from} — {to}):\n{report}',
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
  const lookbackWorkingDays = clampInt(settings.lookbackWorkingDays, 1, 30, DEFAULT_SETTINGS.lookbackWorkingDays);
  return {
    lookbackWorkingDays,
    // Прощать всё окно целиком нельзя — тогда проверять было бы нечего, поэтому
    // допустимая задержка всегда оставляет хотя бы один спрашиваемый день.
    acceptableDelayDays: clampInt(
      settings.acceptableDelayDays,
      0,
      lookbackWorkingDays - 1,
      Math.min(DEFAULT_SETTINGS.acceptableDelayDays, lookbackWorkingDays - 1)
    ),
    runTimes: parseRunTimes(settings.runTimes).times.slice(0, MAX_RUN_TIMES),
    managerRunTimes: parseRunTimes(settings.managerRunTimes).times.slice(0, MAX_RUN_TIMES),
    skipWeekends: Boolean(settings.skipWeekends),
    skipHolidays: Boolean(settings.skipHolidays),
    skipVacations: Boolean(settings.skipVacations),
    skipDmWhileOnLeave: Boolean(settings.skipDmWhileOnLeave),
    messageTemplate: String(settings.messageTemplate || DEFAULT_SETTINGS.messageTemplate).slice(0, 1000),
    managerMessageTemplate: String(
      settings.managerMessageTemplate || DEFAULT_SETTINGS.managerMessageTemplate
    ).slice(0, 1000),
    managerAllClearTemplate: String(
      settings.managerAllClearTemplate || DEFAULT_SETTINGS.managerAllClearTemplate
    ).slice(0, 1000),
    detailedReportTemplate: String(
      settings.detailedReportTemplate || DEFAULT_SETTINGS.detailedReportTemplate
    ).slice(0, 1000),
  };
}

/** Целое из формы: пустое поле или мусор дают дефолт, число прижимается к границам. */
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.min(Math.max(fallback, min), max);
  return Math.min(Math.max(Math.trunc(number), min), max);
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

// managerIds и calendarName появились позже самих записей, поэтому подставляем
// значения по умолчанию на чтении.
const trackedUsers = peopleList(KEY.trackedUsers, {
  onCreate: () => ({ managerIds: [], calendarName: null }),
  normalize: (user) => ({
    ...user,
    managerIds: user.managerIds ?? [],
    calendarName: user.calendarName ?? null,
  }),
});

// Детально отслеживаемые: список независим от Tracked users — человек может быть
// в обоих, только в одном или ни в одном. Своего email им не нужно (сообщение уходит
// менеджеру), но общая механика списка того не стоит, чтобы её здесь ломать.
const detailedUsers = peopleList(KEY.detailedUsers, {
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
 * Как человек назван в календаре отпусков, если там его пишут не так, как в Jira.
 * Пустое значение возвращает поиск к displayName. Несколько написаний задаются
 * через запятую — совпадения любого из них достаточно.
 */
export async function setTrackedUserCalendarName(accountId, calendarName) {
  const users = await trackedUsers.read();
  const user = users.find((u) => u.accountId === accountId);
  if (!user) throw new Error(`User ${accountId} is not tracked`);

  const value = String(calendarName ?? '').trim();
  user.calendarName = value.length > 0 ? value.slice(0, 200) : null;
  return trackedUsers.write(users);
}

/**
 * Назначает человеку менеджеров. Принимаем только тех, кто есть в списке
 * менеджеров: иначе в записи копились бы ссылки на давно удалённых людей.
 *
 * Колонка Managers есть у обоих списков людей, но значит в них разное: у Tracked
 * users — кому уйдёт дайджест о долге, у Detailed tracking users — кто получит
 * подробный отчёт. Механика одна, поэтому она здесь.
 */
async function assignManagers(list, listName, accountId, managerIds) {
  const known = new Set((await managers.read()).map((m) => m.accountId));
  const people = await list.read();
  const person = people.find((p) => p.accountId === accountId);
  if (!person) throw new Error(`User ${accountId} is not in the ${listName} list`);

  person.managerIds = [...new Set(managerIds ?? [])].filter((id) => known.has(id));
  return list.write(people);
}

export const setTrackedUserManagers = (accountId, managerIds) =>
  assignManagers(trackedUsers, 'tracked users', accountId, managerIds);

/* ------------------ детально отслеживаемые пользователи ------------------ */

export const getDetailedUsers = () => detailedUsers.read();
export const addDetailedUsers = async (candidates) => {
  const { people, added, skipped } = await detailedUsers.add(candidates);
  return { detailedUsers: people, added, skipped };
};
export const removeDetailedUsers = (accountIds) => detailedUsers.remove(accountIds);
export const setDetailedUserManagers = (accountId, managerIds) =>
  assignManagers(detailedUsers, 'detailed tracking', accountId, managerIds);

/* ------------------------------ менеджеры ------------------------------ */

export const getManagers = () => managers.read();
export const addManagers = async (candidates) => {
  const { people, added, skipped } = await managers.add(candidates);
  return { managers: people, added, skipped };
};
export const setManagerEmail = (accountId, email) => managers.setEmail(accountId, email);
export const cacheManagerSlackUserIds = (idsByAccountId) => managers.cacheSlackIds(idsByAccountId);

/**
 * Удаление менеджера снимает его и со всех подчинённых — в обоих списках: висящая
 * ссылка на удалённого человека молча выключила бы и дайджест, и детальный отчёт.
 */
export async function removeManagers(accountIds) {
  const drop = new Set(accountIds ?? []);
  const next = await managers.remove(accountIds);

  return {
    managers: next,
    users: await detachManagers(trackedUsers, drop),
    detailedUsers: await detachManagers(detailedUsers, drop),
  };
}

async function detachManagers(list, drop) {
  const people = await list.read();
  let changed = false;
  for (const person of people) {
    const kept = (person.managerIds ?? []).filter((id) => !drop.has(id));
    if (kept.length !== (person.managerIds ?? []).length) {
      person.managerIds = kept;
      changed = true;
    }
  }
  return changed ? list.write(people) : people;
}

/* ------------------------------ праздники ------------------------------ */

/**
 * Календарь праздников. Пока в KVS ничего нет, отдаётся набор по умолчанию;
 * пустой список — это осознанно очищенный администратором календарь, и подменять
 * его дефолтом нельзя (иначе удалённые праздники возвращались бы сами).
 */
export async function getHolidays() {
  const stored = await kvs.get(KEY.holidays);
  if (!Array.isArray(stored)) return sortHolidays(DEFAULT_HOLIDAYS);

  // Битую запись пропускаем молча: из-за одного испорченного правила не должна
  // падать вся страница настроек и тем более прогон.
  const holidays = [];
  for (const raw of stored) {
    try {
      holidays.push(normalizeHoliday(raw));
    } catch (e) {
      console.warn(`Праздник пропущен: ${e.message}`);
    }
  }
  return sortHolidays(holidays);
}

export async function addHoliday(raw) {
  const holiday = normalizeHoliday(raw);
  const holidays = await getHolidays();
  if (holidays.some((existing) => existing.id === holiday.id)) {
    throw new Error(`A holiday with id ${holiday.id} already exists`);
  }
  return writeHolidays([...holidays, holiday]);
}

export async function removeHolidays(ids) {
  const drop = new Set(ids ?? []);
  return writeHolidays((await getHolidays()).filter((holiday) => !drop.has(holiday.id)));
}

/** Возврат к набору по умолчанию — иначе удалённый праздник пришлось бы вводить руками. */
export async function resetHolidays() {
  return writeHolidays(DEFAULT_HOLIDAYS);
}

async function writeHolidays(holidays) {
  const next = sortHolidays(holidays);
  await kvs.set(KEY.holidays, next);
  return next;
}

/** По дате в текущем году: календарь читается сверху вниз как календарь. */
function sortHolidays(holidays) {
  const year = new Date().getUTCFullYear();
  return [...holidays].sort((a, b) => {
    const dateA = holidayDate(a, year) ?? '';
    const dateB = holidayDate(b, year) ?? '';
    return dateA.localeCompare(dateB) || a.name.localeCompare(b.name);
  });
}

/* ------------------------------ секреты ------------------------------ */

export async function getCredentials() {
  const values = await Promise.all(CREDENTIAL_NAMES.map((name) => kvs.getSecret(SECRET_KEY[name])));
  return Object.fromEntries(CREDENTIAL_NAMES.map((name, i) => [name, values[i] ?? null]));
}

/**
 * Статус для UI: сам секрет не отдаём, только «задан / не задан», хвост и время обновления.
 */
export async function getCredentialsStatus() {
  const [credentials, meta] = await Promise.all([
    getCredentials(),
    kvs.get(KEY.credentialsMeta).then((v) => v ?? {}),
  ]);
  return Object.fromEntries(
    CREDENTIAL_NAMES.map((name) => [name, describeCredential(name, credentials[name], meta[name])])
  );
}

function describeCredential(name, value, meta) {
  return {
    isSet: Boolean(value),
    // У токена показываем хвост — по нему администратор узнаёт, какой именно
    // токен лежит. У ссылки на календарь хвост всегда один и тот же (basic.ics),
    // а вот id календаря секретом не является и сразу отвечает на вопрос
    // «тот ли календарь подключён».
    maskedTail: value ? (name === 'vacationIcsUrl' ? calendarIdOf(value) : `…${String(value).slice(-4)}`) : null,
    updatedAt: meta?.updatedAt ?? null,
  };
}

/** `…/ical/{id}/private-{key}/basic.ics` → id календаря, без секретной части. */
function calendarIdOf(icsUrl) {
  const id = /\/ical\/([^/]+)\//.exec(String(icsUrl))?.[1];
  if (!id) return 'link set';
  return decodeURIComponent(id).split('@')[0].slice(0, 40);
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
// Детальных отчётов ещё меньше: строка на пару «сотрудник — его менеджер».
const MAX_DETAILED_ROWS = 100;

// Что важнее увидеть в UI, если строк больше лимита.
const ROW_PRIORITY = {
  error: 0,
  'no-slack': 1,
  'no-email': 1,
  'no-manager': 1,
  reminded: 2,
  notified: 2,
  reported: 2,
  logged: 3,
  'all-clear': 3,
  'on-leave': 3,
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
  const detailed = trimRows(report.detailedRows, MAX_DETAILED_ROWS);
  const stored = {
    ...report,
    rows: users.rows,
    truncatedRows: users.truncated,
    managerRows: managerDigests.rows,
    truncatedManagerRows: managerDigests.truncated,
    detailedRows: detailed.rows,
    truncatedDetailedRows: detailed.truncated,
  };
  await kvs.set(KEY.lastReport, stored);
  return stored;
}
