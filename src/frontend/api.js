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
  saveCredential: (name, value) => call('saveCredential', { name, value }),
  clearCredential: (name) => call('clearCredential', { name }),
  testConnections: () => call('testConnections'),
  saveSettings: (settings) => call('saveSettings', { settings }),
  startRun: () => call('startRun'),
  getRunState: () => call('getRunState'),
};
