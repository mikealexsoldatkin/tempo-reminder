import { makeResolver } from '@forge/resolver';
import { isJiraAdmin, searchProjectMembers, searchUsersByName } from './jira.js';
import { testTempoToken } from './tempo.js';
import { testSlackToken } from './slack.js';
import { enqueueRun } from './runQueue.js';
import {
  addTrackedUsers,
  clearCredential,
  getCredentials,
  getCredentialsStatus,
  getLastReport,
  getRunStatus,
  getSettings,
  getTrackedUsers,
  removeTrackedUsers,
  saveCredential,
  saveSettings,
  setTrackedUserEmail,
} from './store.js';

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
  const [settings, trackedUsers, credentials, runStatus, lastReport] = await Promise.all([
    getSettings(),
    getTrackedUsers(),
    getCredentialsStatus(),
    getRunStatus(),
    getLastReport(),
  ]);
  return { settings, trackedUsers, credentials, runStatus, lastReport };
});

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

/* ------------------------------ токены и настройки ------------------------------ */

define('saveCredential', async ({ payload }) => {
  await saveCredential(payload?.name, payload?.value);
  return { credentials: await getCredentialsStatus() };
});

define('clearCredential', async ({ payload }) => {
  await clearCredential(payload?.name);
  return { credentials: await getCredentialsStatus() };
});

define('testConnections', async () => {
  const { tempoToken, slackBotToken } = await getCredentials();
  const [tempo, slack] = await Promise.all([
    tempoToken
      ? testTempoToken(tempoToken)
      : Promise.resolve({ ok: false, message: 'Tempo API token is not set' }),
    slackBotToken
      ? testSlackToken(slackBotToken)
      : Promise.resolve({ ok: false, message: 'Slack bot token is not set' }),
  ]);
  return { tempo, slack };
});

define('saveSettings', async ({ payload }) => ({
  settings: await saveSettings(payload?.settings ?? {}),
}));

/* --------------------------------- прогон --------------------------------- */

define('startRun', async ({ context }) => enqueueRun('manual', context?.accountId ?? null));

define('getRunState', async () => {
  const [runStatus, lastReport] = await Promise.all([getRunStatus(), getLastReport()]);
  return { runStatus, lastReport };
});

export const handler = makeResolver(handlers);
