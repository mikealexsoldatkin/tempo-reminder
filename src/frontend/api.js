import { invoke } from '@forge/bridge';

/**
 * Резолверы отвечают конвертом {ok, data|error}; здесь разворачиваем его
 * в обычный промис, чтобы в компонентах писать try/catch.
 */
async function call(functionKey, payload) {
  const response = await invoke(functionKey, payload);
  if (!response?.ok) throw new Error(response?.error ?? 'The backend returned an empty response');
  return response.data;
}

export const api = {
  getState: () => call('getState'),
  searchUsersByName: (query) => call('searchUsersByName', { query }),
  searchProjectMembers: (projectKey) => call('searchProjectMembers', { projectKey }),
  addTrackedUsers: (users) => call('addTrackedUsers', { users }),
  removeTrackedUsers: (accountIds) => call('removeTrackedUsers', { accountIds }),
  setTrackedUserEmail: (accountId, email) => call('setTrackedUserEmail', { accountId, email }),
  setTrackedUserManagers: (accountId, managerIds) =>
    call('setTrackedUserManagers', { accountId, managerIds }),
  setTrackedUserCalendarName: (accountId, calendarName) =>
    call('setTrackedUserCalendarName', { accountId, calendarName }),
  addDetailedUsers: (users) => call('addDetailedUsers', { users }),
  removeDetailedUsers: (accountIds) => call('removeDetailedUsers', { accountIds }),
  setDetailedUserManagers: (accountId, managerIds) =>
    call('setDetailedUserManagers', { accountId, managerIds }),
  addManagers: (users) => call('addManagers', { users }),
  removeManagers: (accountIds) => call('removeManagers', { accountIds }),
  setManagerEmail: (accountId, email) => call('setManagerEmail', { accountId, email }),
  saveCredential: (name, value) => call('saveCredential', { name, value }),
  clearCredential: (name) => call('clearCredential', { name }),
  testConnections: () => call('testConnections'),
  testVacationCalendar: () => call('testVacationCalendar'),
  saveSettings: (settings) => call('saveSettings', { settings }),
  addHoliday: (holiday) => call('addHoliday', { holiday }),
  removeHolidays: (ids) => call('removeHolidays', { ids }),
  resetHolidays: () => call('resetHolidays'),
  startRun: () => call('startRun'),
  getRunState: () => call('getRunState'),
};
