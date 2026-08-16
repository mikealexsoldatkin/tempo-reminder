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
import { Panel } from './components/layout';

const AdminPage = () => {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.getState().then(setState).catch((e) => setLoadError(e.message));
  }, []);

  const patch = useCallback((changes) => setState((prev) => ({ ...prev, ...changes })), []);
  const onUsersChange = useCallback((trackedUsers) => patch({ trackedUsers }), [patch]);
  const onManagersChange = useCallback((managers) => patch({ managers }), [patch]);
  // Резолверы доступов отвечают целиком {credentials, slack, tempo}: подключение
  // и его токен меняются вместе, и разъезжаться им нельзя. Берём из ответа только
  // известные ключи — в нём приезжает и то, что состоянием страницы не является
  // (результат отзыва токена, например).
  const onCredentialsChange = useCallback(
    ({ credentials, slack, tempo }) =>
      setState((prev) => ({
        ...prev,
        credentials: credentials ?? prev.credentials,
        slack: slack ?? prev.slack,
        tempo: tempo ?? prev.tempo,
      })),
    []
  );

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
        slack={state.slack}
        tempo={state.tempo}
        trackedUsers={state.trackedUsers}
        managers={state.managers}
      />

      {/* Порядок вкладок — это порядок первой настройки: без токенов бессмысленно
          заводить людей, без людей — крутить параметры проверки. */}
      <Tabs id="tempo-reminder-tabs">
        <TabList>
          {/* Не «Access tokens» и не «Access»: токенов на вкладке больше нет
              вовсе — обе системы подключаются кнопкой. */}
          <Tab>Connections</Tab>
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
              slack={state.slack}
              tempo={state.tempo}
              onCredentialsChange={onCredentialsChange}
            />
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            {/* Поиск людей уехал во всплывающие окна: формы нужны редко, а места
                над таблицами занимали столько, что списки уходили под сгиб. Кнопки
                отдаются таблице и встают в её собственный ряд действий, рядом с
                «Remove selected». Каждая таблица пополняется только собой: в
                менеджеры добавляют поиском по имени, под наблюдение — ещё и целым
                проектом. */}
            <Stack space="space.200">
              {/* Менеджеры идут первыми: колонки в Tracked users выбирают из этого
                  списка, и пустой он делает их нередактируемыми. Каждая таблица —
                  своя панель: списки длинные, и без рамки конец одного и начало
                  другого различались только пустой строкой между ними. */}
              <Panel>
                <ManagersTable
                  managers={state.managers}
                  onManagersChange={onManagersChange}
                  onUsersChange={onUsersChange}
                  addActions={
                    <AddPeopleActions
                      action="manager"
                      trackedIds={trackedIds}
                      managerIds={managerIds}
                      onUsersChange={onUsersChange}
                      onManagersChange={onManagersChange}
                    />
                  }
                />
              </Panel>
              <Panel>
                <TrackedUsersTable
                  users={state.trackedUsers}
                  managers={state.managers}
                  onUsersChange={onUsersChange}
                  addActions={
                    <AddPeopleActions
                      action="track"
                      trackedIds={trackedIds}
                      managerIds={managerIds}
                      onUsersChange={onUsersChange}
                      onManagersChange={onManagersChange}
                    />
                  }
                />
              </Panel>
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
              onCredentialsChange={onCredentialsChange}
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
