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
import { AddPeopleActions } from './components/AddPeopleActions';
import { TrackedUsersTable } from './components/TrackedUsersTable';
import { ManagersTable } from './components/ManagersTable';
import { CredentialsTab } from './components/CredentialsTab';
import { SettingsTab } from './components/SettingsTab';
import { HolidaysTab } from './components/HolidaysTab';
import { VacationsTab } from './components/VacationsTab';
import { RunTab } from './components/RunTab';
import { ReadinessBanner } from './components/ReadinessBanner';
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
  // Детальный отчёт — не отдельный список, а колонка получателей у отслеживаемого.
  const detailedCount = useMemo(
    () => (state?.trackedUsers ?? []).filter((u) => (u.detailedManagerIds ?? []).length > 0).length,
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
        On a schedule you set, the app checks tracked Jira users against their Tempo worklogs. People
        missing time get a Slack DM; their managers get a digest, and — for anyone you mark — a
        day-by-day breakdown of what was logged.
      </Text>

      <ReadinessBanner
        settings={state.settings}
        credentials={state.credentials}
        trackedUsers={state.trackedUsers}
        managers={state.managers}
      />

      {/* Порядок вкладок — это порядок первой настройки: без токенов бессмысленно
          заводить людей, без людей — крутить параметры проверки. */}
      <Tabs id="tempo-reminder-tabs">
        <TabList>
          <Tab>Access tokens</Tab>
          <Tab>Users</Tab>
          <Tab>Check parameters</Tab>
          <Tab>Holidays</Tab>
          <Tab>Vacations</Tab>
          <Tab>Run check</Tab>
        </TabList>

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
            {/* Поиск людей уехал во всплывающие окна: обе формы нужны редко, а
                места над таблицами занимали столько, что списки уходили под сгиб.
                Кнопки стоят под каждой таблицей — окно всё равно одно и то же и
                умеет оба действия, так что открывать его удобно оттуда, где сейчас
                смотришь. */}
            <Stack space="space.400">
              {/* Менеджеры идут первыми: колонки в Tracked users выбирают из этого
                  списка, и пустой он делает их нередактируемыми. */}
              <Stack space="space.200">
                <ManagersTable
                  managers={state.managers}
                  onManagersChange={onManagersChange}
                  onUsersChange={onUsersChange}
                />
                <AddPeopleActions
                  trackedIds={trackedIds}
                  managerIds={managerIds}
                  onUsersChange={onUsersChange}
                  onManagersChange={onManagersChange}
                />
              </Stack>
              <Stack space="space.200">
                <TrackedUsersTable
                  users={state.trackedUsers}
                  managers={state.managers}
                  onUsersChange={onUsersChange}
                />
                <AddPeopleActions
                  trackedIds={trackedIds}
                  managerIds={managerIds}
                  onUsersChange={onUsersChange}
                  onManagersChange={onManagersChange}
                />
              </Stack>
            </Stack>
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
            <VacationsTab
              settings={state.settings}
              credentials={state.credentials}
              onSettingsChange={(settings) => patch({ settings })}
              onCredentialsChange={(credentials) => patch({ credentials })}
            />
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <RunTab
              runStatus={state.runStatus}
              lastReport={state.lastReport}
              trackedCount={state.trackedUsers.length}
              detailedCount={detailedCount}
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
