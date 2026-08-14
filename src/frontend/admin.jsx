import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box,
  Heading,
  Inline,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  xcss,
} from '@forge/react';
import { api } from './api';
import { AddByNameSection } from './components/AddByNameSection';
import { AddByProjectSection } from './components/AddByProjectSection';
import { TrackedUsersTable } from './components/TrackedUsersTable';
import { ManagersTable } from './components/ManagersTable';
import { CredentialsTab } from './components/CredentialsTab';
import { SettingsTab } from './components/SettingsTab';
import { HolidaysTab } from './components/HolidaysTab';
import { VacationsTab } from './components/VacationsTab';
import { RunTab } from './components/RunTab';
import { ReadinessBanner } from './components/ReadinessBanner';
import { ErrorBoundary } from './components/ErrorBoundary';

// Две секции поиска стоят рядом, в одну строку: width 100% + flexGrow внутри
// Inline с grow="fill" означает «поделить поровну всё, что есть», и колонки
// ужимаются вместе с окном.
//
// Без shouldWrap намеренно: при переносе строки каждая колонка требует свои
// width: 100% и они встают друг под друга. Задать вместо этого нижнюю границу
// через flexBasis нельзя — xcss пропускает только белый список свойств, и
// flexBasis в него не входит (в отличие от flexGrow, width и minWidth).
const searchColumnStyles = xcss({ width: '100%', flexGrow: 1 });

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
            <Stack space="space.400">
              <Inline space="space.400" alignBlock="start" grow="fill">
                <Box xcss={searchColumnStyles}>
                  <AddByNameSection
                    trackedIds={trackedIds}
                    managerIds={managerIds}
                    onUsersChange={onUsersChange}
                    onManagersChange={onManagersChange}
                  />
                </Box>
                <Box xcss={searchColumnStyles}>
                  <AddByProjectSection
                    trackedIds={trackedIds}
                    managerIds={managerIds}
                    onUsersChange={onUsersChange}
                    onManagersChange={onManagersChange}
                  />
                </Box>
              </Inline>
              {/* Менеджеры идут первыми: колонки в Tracked users выбирают из этого
                  списка, и пустой он делает их нередактируемыми. */}
              <ManagersTable
                managers={state.managers}
                onManagersChange={onManagersChange}
                onUsersChange={onUsersChange}
              />
              <TrackedUsersTable
                users={state.trackedUsers}
                managers={state.managers}
                onUsersChange={onUsersChange}
              />
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
