import { makeResolver } from '@forge/resolver';
import { isJiraAdmin, searchProjectMembers, searchUsersByName } from './jira.js';
import { testTempoToken } from './tempo.js';
import { testSlackToken } from './slack.js';
import { disconnectSlack, getSlackStatus, startSlackConnect } from './slackOAuth.js';
import { isRevokedTokenError } from './slackOAuthState.js';
import { testVacationCalendar } from './vacationCalendar.js';
import { enqueueRun } from './runQueue.js';
import { describeSchedule } from './reminder.js';
import {
  addHoliday,
  addManagers,
  addTrackedUsers,
  clearCredential,
  getCredentials,
  getCredentialsStatus,
  getHolidays,
  getLastReport,
  getManagers,
  getRunStatus,
  getSettings,
  getTrackedUsers,
  markSlackConnectionRevoked,
  removeHolidays,
  removeManagers,
  removeTrackedUsers,
  resetHolidays,
  saveCredential,
  saveSettings,
  setManagerEmail,
  setTrackedUserCalendarName,
  setTrackedUserDetailedManagers,
  setTrackedUserEmail,
  setTrackedUserManagers,
} from './store.js';
import { describeHolidays } from './holidays.js';
import { isoDate } from './workdays.js';

// Собираем обработчики в объект и отдаём их в makeResolver, а не в `new Resolver()`:
// package.json объявляет "type": "module", поэтому webpack связывает default-импорт
// CJS-пакета со всем module.exports — и `new Resolver()` падает с "out is not a constructor".
const handlers = {};

/**
 * Все резолверы возвращают «конверт» {ok, data|error}: сообщения об ошибках
 * доезжают до UI как есть, без зависимости от того, как Forge пробрасывает исключения.
 */
function define(key, handler) {
  handlers[key] = async (req) => {
    try {
      if (!(await isJiraAdmin())) {
        return { ok: false, error: 'Jira administrator permissions are required' };
      }
      return { ok: true, data: await handler(req) };
    } catch (e) {
      console.error(`Резолвер ${key} упал: ${e.stack ?? e.message}`);
      return { ok: false, error: e.message ?? 'Unknown error' };
    }
  };
}

/** Полное состояние страницы настроек за один вызов. */
define('getState', async () => {
  const [settings, trackedUsers, managers, credentials, slack, runStatus, lastReport, holidays] =
    await Promise.all([
      getSettings(),
      getTrackedUsers(),
      getManagers(),
      getCredentialsStatus(),
      getSlackStatus(),
      getRunStatus(),
      getLastReport(),
      getHolidays(),
    ]);
  return {
    settings,
    trackedUsers,
    managers,
    credentials,
    slack,
    runStatus,
    lastReport,
    holidays: withDates(holidays),
    schedule: await describeSchedule(settings),
  };
});

/* -------------------------------- праздники -------------------------------- */

/**
 * Правило разворачивает в дату бэкенд: календарная арифметика уже написана и
 * покрыта тестами здесь, а UI остаётся простой таблицей.
 */
const withDates = (holidays) => describeHolidays(holidays, isoDate(new Date()));

define('addHoliday', async ({ payload }) => ({
  holidays: withDates(await addHoliday(payload?.holiday ?? {})),
}));

define('removeHolidays', async ({ payload }) => ({
  holidays: withDates(await removeHolidays(payload?.ids ?? [])),
}));

define('resetHolidays', async () => ({ holidays: withDates(await resetHolidays()) }));

/* ------------------------ отслеживаемые пользователи ------------------------ */

define('searchUsersByName', ({ payload }) => searchUsersByName(payload?.query));

define('searchProjectMembers', ({ payload }) => searchProjectMembers(payload?.projectKey));

define('addTrackedUsers', ({ payload }) => addTrackedUsers(payload?.users ?? []));

define('removeTrackedUsers', async ({ payload }) => ({
  users: await removeTrackedUsers(payload?.accountIds ?? []),
}));

define('setTrackedUserEmail', async ({ payload }) => ({
  users: await setTrackedUserEmail(payload?.accountId, payload?.email),
}));

// Два набора получателей у одного сотрудника: дайджест «не отчитался» и разбор
// worklog'ов по дням. Ручки раздельные — колонки в таблице редактируются независимо.
define('setTrackedUserManagers', async ({ payload }) => ({
  users: await setTrackedUserManagers(payload?.accountId, payload?.managerIds ?? []),
}));

define('setTrackedUserDetailedManagers', async ({ payload }) => ({
  users: await setTrackedUserDetailedManagers(payload?.accountId, payload?.managerIds ?? []),
}));

define('setTrackedUserCalendarName', async ({ payload }) => ({
  users: await setTrackedUserCalendarName(payload?.accountId, payload?.calendarName),
}));

/* --------------------------------- менеджеры --------------------------------- */

define('addManagers', ({ payload }) => addManagers(payload?.users ?? []));

// Удаление менеджера снимает его и с сотрудников — в обоих наборах получателей,
// поэтому возвращаем оба обновлённых списка.
define('removeManagers', ({ payload }) => removeManagers(payload?.accountIds ?? []));

define('setManagerEmail', async ({ payload }) => ({
  managers: await setManagerEmail(payload?.accountId, payload?.email),
}));

/* ------------------------------ токены и настройки ------------------------------ */

define('saveCredential', async ({ payload }) => {
  await saveCredential(payload?.name, payload?.value);
  return { credentials: await getCredentialsStatus(), slack: await getSlackStatus() };
});

define('clearCredential', async ({ payload }) => {
  await clearCredential(payload?.name);
  return { credentials: await getCredentialsStatus(), slack: await getSlackStatus() };
});

define('testConnections', async () => {
  const { tempoToken, slackBotToken } = await getCredentials();
  const [tempo, slack] = await Promise.all([
    tempoToken
      ? testTempoToken(tempoToken)
      : Promise.resolve({ ok: false, message: 'Tempo API token is not set' }),
    slackBotToken
      ? testSlackToken(slackBotToken)
      : Promise.resolve({ ok: false, message: 'Slack is not connected' }),
  ]);
  // Проверка — второе место (после прогона), где видно, что токен на той стороне
  // отозвали. Молчать об этом здесь значило бы оставить в сводке готовности
  // «подключено» рядом с красной строкой проверки.
  if (isRevokedTokenError(slack.slackError)) await markSlackConnectionRevoked(slack.slackError);
  return { tempo, slack };
});

/**
 * Проверка календаря отпусков. Отвечает не только «читается / не читается»:
 * администратору нужно видеть, как заголовки событий раскладываются на список
 * отслеживаемых, иначе разошедшееся написание имени обнаружится только по
 * напоминанию, ушедшему человеку в отпуске.
 */
define('testVacationCalendar', async () => {
  const { vacationIcsUrl } = await getCredentials();
  if (!vacationIcsUrl) {
    return { ok: false, message: 'The vacation calendar iCal address is not set' };
  }
  return testVacationCalendar({
    icsUrl: vacationIcsUrl,
    people: await getTrackedUsers(),
    today: isoDate(new Date()),
  });
});

define('saveSettings', async ({ payload }) => {
  const settings = await saveSettings(payload?.settings ?? {});
  // Расписание пересчитываем сразу: администратор должен увидеть, во что превратился
  // введённый им список времён и когда теперь ближайший запуск.
  return { settings, schedule: await describeSchedule(settings) };
});

/* ----------------------------- подключение Slack ----------------------------- */

/**
 * Ссылку на экран согласия собирает бэкенд: в ней одноразовый nonce и адрес
 * веб-триггера этой установки, и то и другое фронтенду знать неоткуда.
 * Открывает её страница настроек — router.open в соседней вкладке.
 */
define('startSlackConnect', ({ context }) => startSlackConnect(context?.accountId ?? null));

/**
 * Опрос, пока администратор ходит по вкладке Slack: подключение приезжает не
 * в ответ на действие в UI, а через веб-триггер, и заметить его можно только так.
 */
define('getSlackStatus', async () => ({
  slack: await getSlackStatus(),
  credentials: await getCredentialsStatus(),
}));

define('disconnectSlack', async () => {
  const revoked = await disconnectSlack();
  return { revoked, credentials: await getCredentialsStatus(), slack: await getSlackStatus() };
});

/* --------------------------------- прогон --------------------------------- */

define('startRun', async ({ context }) => enqueueRun('manual', context?.accountId ?? null));

define('getRunState', async () => {
  const [runStatus, lastReport] = await Promise.all([getRunStatus(), getLastReport()]);
  return { runStatus, lastReport };
});

export const handler = makeResolver(handlers);
