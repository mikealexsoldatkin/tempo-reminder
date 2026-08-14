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
import { ManagersTable } from './components/ManagersTable';
import { CredentialsTab } from './components/CredentialsTab';
import { SettingsTab } from './components/SettingsTab';
import { HolidaysTab } from './components/HolidaysTab';
import { RunTab } from './components/RunTab';
import { ErrorBoundary } from './components/ErrorBoundary';

const AdminPage = () => {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.getState().then(setState).catch((e) => setLoadError(e.message));
  }, []);

  const patch = useCallback((changes) => setState((prev) => ({ ...prev, ...changes })), []);
  const onUsersChange = useCallback((trackedUsers) => patch({ trackedUsers }), [patch]);
  const onManagersChange = useCallback((managers) => patch({ managers }), [patch]);

  const trackedIds = useMemo(
    () => new Set((state?.trackedUsers ?? []).map((u) => u.accountId)),
    [state?.trackedUsers]
  );
  const managerIds = useMemo(
    () => new Set((state?.managers ?? []).map((m) => m.accountId)),
    [state?.managers]
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
          <Tab>Access tokens</Tab>
          <Tab>Check parameters</Tab>
          <Tab>Holidays</Tab>
          <Tab>Run check</Tab>
        </TabList>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <Stack space="space.400">
              <AddByNameSection
                trackedIds={trackedIds}
                managerIds={managerIds}
                onUsersChange={onUsersChange}
                onManagersChange={onManagersChange}
              />
              <AddByProjectSection
                trackedIds={trackedIds}
                managerIds={managerIds}
                onUsersChange={onUsersChange}
                onManagersChange={onManagersChange}
              />
              <TrackedUsersTable
                users={state.trackedUsers}
                managers={state.managers}
                onUsersChange={onUsersChange}
              />
              <ManagersTable
                managers={state.managers}
                onManagersChange={onManagersChange}
                onUsersChange={onUsersChange}
              />
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <CredentialsTab
              credentials={state.credentials}
              onCredentialsChange={(credentials) => patch({ credentials })}
            />
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <SettingsTab
              settings={state.settings}
              schedule={state.schedule}
              onSettingsChange={(settings) => patch({ settings })}
            />
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <HolidaysTab
              holidays={state.holidays}
              settings={state.settings}
              onHolidaysChange={(holidays) => patch({ holidays })}
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
    <ErrorBoundary>
      <AdminPage />
    </ErrorBoundary>
  </React.StrictMode>
);
