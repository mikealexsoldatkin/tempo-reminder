import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box,
  Heading,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from '@forge/react';
import { api } from './api';
import { AddByNameSection } from './components/AddByNameSection';
import { AddByProjectSection } from './components/AddByProjectSection';
import { TrackedUsersTable } from './components/TrackedUsersTable';
import { CredentialsTab } from './components/CredentialsTab';
import { RunTab } from './components/RunTab';

const AdminPage = () => {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.getState().then(setState).catch((e) => setLoadError(e.message));
  }, []);

  const patch = useCallback((changes) => setState((prev) => ({ ...prev, ...changes })), []);
  const onUsersChange = useCallback((trackedUsers) => patch({ trackedUsers }), [patch]);

  const trackedIds = useMemo(
    () => new Set((state?.trackedUsers ?? []).map((u) => u.accountId)),
    [state?.trackedUsers]
  );

  if (loadError) {
    return (
      <SectionMessage appearance="error" title="Couldn’t load settings">
        <Text>{loadError}</Text>
      </SectionMessage>
    );
  }

  if (!state) {
    return (
      <Box padding="space.200">
        <Spinner size="large" />
      </Box>
    );
  }

  return (
    <Stack space="space.200">
      <Heading as="h2" size="large">Unlogged time reminders</Heading>
      <Text>
        Once a day the app checks tracked Jira users against their Tempo worklogs and sends a Slack
        DM to everyone who hasn’t logged time within the check window.
      </Text>

      <Tabs id="tempo-reminder-tabs">
        <TabList>
          <Tab>Users</Tab>
          <Tab>Tokens and settings</Tab>
          <Tab>Run check</Tab>
        </TabList>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <Stack space="space.400">
              <AddByNameSection trackedIds={trackedIds} onUsersChange={onUsersChange} />
              <AddByProjectSection trackedIds={trackedIds} onUsersChange={onUsersChange} />
              <TrackedUsersTable users={state.trackedUsers} onUsersChange={onUsersChange} />
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <CredentialsTab
              credentials={state.credentials}
              settings={state.settings}
              onCredentialsChange={(credentials) => patch({ credentials })}
              onSettingsChange={(settings) => patch({ settings })}
            />
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <RunTab
              runStatus={state.runStatus}
              lastReport={state.lastReport}
              trackedCount={state.trackedUsers.length}
              credentials={state.credentials}
              onRunStateChange={({ runStatus, lastReport }) => patch({ runStatus, lastReport })}
            />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <AdminPage />
  </React.StrictMode>
);
