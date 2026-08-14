import React, { useState } from 'react';
import {
  Box,
  Checkbox,
  Heading,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  TextArea,
  Textfield,
  xcss,
} from '@forge/react';
import { api } from '../api';

// TextArea тянется на всю ширину родителя и своей ширины не имеет, поэтому размер
// трём шаблонам задаёт обёртка, а не сами поля. width: '100%' + flexGrow внутри Inline
// означает «занять всё, что есть»: колонки равномерно ужимаются от полной ширины
// страницы и остаются одинаковыми, каких бы размеров ни было окно.
const templateFieldStyles = xcss({ width: '100%', flexGrow: 1 });

const CREDENTIALS = [
  {
    name: 'tempoToken',
    title: 'Tempo API token',
    hint: 'Tempo → Settings → API integration → New token. Needs read access to worklogs.',
  },
  {
    name: 'slackBotToken',
    title: 'Slack bot token (xoxb-…)',
    hint: 'Scopes: users:read, users:read.email, chat:write, im:write.',
  },
];

/**
 * Времена запуска хранятся массивом ('HH:MM'), а редактируются одной строкой —
 * бэкенд принимает и то, и другое, поэтому форма держит строку и не пытается
 * разбирать ввод на лету: нормализацию делает сервер и возвращает результат.
 */
/**
 * Задержка не может съесть всё окно — иначе спрашивать было бы не о чем. Бэкенд
 * прижимает значение сам, здесь то же правило нужно лишь стрелкам в поле.
 */
const maxDelayFor = (lookbackWorkingDays) => {
  const lookback = Number(lookbackWorkingDays);
  return Number.isFinite(lookback) ? Math.max(lookback - 1, 0) : 0;
};

const toForm = (settings) => ({
  ...settings,
  runTimes: (settings.runTimes ?? []).join(', '),
  managerRunTimes: (settings.managerRunTimes ?? []).join(', '),
});

/**
 * Токены хранятся в секретном хранилище Forge (kvs.setSecret) и наружу не отдаются:
 * UI видит только «задан / не задан», последние 4 символа и дату обновления.
 */
export const CredentialsTab = ({
  credentials,
  settings,
  schedule,
  onCredentialsChange,
  onSettingsChange,
}) => {
  const [inputs, setInputs] = useState({ tempoToken: '', slackBotToken: '' });
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [form, setForm] = useState(() => toForm(settings));
  const [scheduleInfo, setScheduleInfo] = useState(schedule ?? null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const withBusy = async (key, action) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const save = (name) =>
    withBusy(`save:${name}`, async () => {
      const result = await api.saveCredential(name, inputs[name]);
      onCredentialsChange(result.credentials);
      setInputs((prev) => ({ ...prev, [name]: '' }));
      setMessage({ appearance: 'success', text: 'Token saved' });
      setTestResults(null);
    });

  const clear = (name) =>
    withBusy(`clear:${name}`, async () => {
      const result = await api.clearCredential(name);
      onCredentialsChange(result.credentials);
      setMessage({ appearance: 'information', text: 'Token removed' });
      setTestResults(null);
    });

  const test = () =>
    withBusy('test', async () => {
      setTestResults(await api.testConnections());
    });

  const saveSettings = async () => {
    setIsSavingSettings(true);
    setMessage(null);
    try {
      const result = await api.saveSettings(form);
      setForm(toForm(result.settings));
      setScheduleInfo(result.schedule ?? null);
      onSettingsChange(result.settings);
      setMessage({ appearance: 'success', text: 'Settings saved' });
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <Stack space="space.300">
      <Stack space="space.150">
        <Heading as="h3" size="medium">Access tokens</Heading>
        <Text>
          The app uses no environment variables: both Tempo and Slack authenticate with the tokens
          from this form. Values are kept in Forge secret storage and are never returned to the UI.
        </Text>

        {CREDENTIALS.map(({ name, title, hint }) => {
          const status = credentials[name] ?? { isSet: false };
          return (
            <Box key={name}>
              <Stack space="space.100">
                <Inline space="space.100" alignBlock="center">
                  <Label labelFor={`credential-${name}`}>{title}</Label>
                  {status.isSet ? (
                    <Lozenge appearance="success">set {status.maskedTail}</Lozenge>
                  ) : (
                    <Lozenge appearance="removed">not set</Lozenge>
                  )}
                </Inline>
                <Inline space="space.100" alignBlock="end">
                  <Textfield
                    id={`credential-${name}`}
                    type="password"
                    width={340}
                    value={inputs[name]}
                    placeholder={status.isSet ? 'Enter a new value to replace it' : 'Paste the token'}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                  <LoadingButton
                    appearance="primary"
                    isLoading={busy === `save:${name}`}
                    isDisabled={inputs[name].trim().length === 0}
                    onClick={() => save(name)}
                  >
                    Save
                  </LoadingButton>
                  <LoadingButton
                    appearance="subtle"
                    isLoading={busy === `clear:${name}`}
                    isDisabled={!status.isSet}
                    onClick={() => clear(name)}
                  >
                    Remove
                  </LoadingButton>
                </Inline>
                <HelperMessage>
                  {hint}
                  {status.updatedAt ? ` Updated: ${new Date(status.updatedAt).toLocaleString()}.` : ''}
                </HelperMessage>
              </Stack>
            </Box>
          );
        })}

        <Inline space="space.100">
          <LoadingButton isLoading={busy === 'test'} onClick={test}>
            Test connection
          </LoadingButton>
        </Inline>

        {testResults && (
          <Stack space="space.100">
            <SectionMessage appearance={testResults.tempo.ok ? 'success' : 'error'}>
              <Text>Tempo: {testResults.tempo.message}</Text>
            </SectionMessage>
            <SectionMessage appearance={testResults.slack.ok ? 'success' : 'error'}>
              <Text>Slack: {testResults.slack.message}</Text>
            </SectionMessage>
          </Stack>
        )}
      </Stack>

      <Stack space="space.150">
        <Heading as="h3" size="medium">Check parameters</Heading>

        <Inline space="space.200" alignBlock="start">
          <Stack space="space.050">
            <Label labelFor="lookback">Working days to check</Label>
            <Textfield
              id="lookback"
              type="number"
              width={120}
              min={1}
              max={30}
              value={String(form.lookbackWorkingDays)}
              onChange={(e) => setForm((prev) => ({ ...prev, lookbackWorkingDays: e.target.value }))}
            />
            <HelperMessage>
              The whole window: the last N working days, including today. Weekends are skipped.
            </HelperMessage>
          </Stack>
          <Stack space="space.050">
            <Label labelFor="acceptable-delay">Acceptable days of delay</Label>
            <Textfield
              id="acceptable-delay"
              type="number"
              width={120}
              min={0}
              max={maxDelayFor(form.lookbackWorkingDays)}
              value={String(form.acceptableDelayDays)}
              onChange={(e) => setForm((prev) => ({ ...prev, acceptableDelayDays: e.target.value }))}
            />
            <HelperMessage>
              How many of the most recent working days are excused — time for them may still be
              missing. 0 means today’s time is already expected.
            </HelperMessage>
          </Stack>
        </Inline>
        <HelperMessage>
          Time has to be logged for every working day of the window, not just for some of them. The
          days actually asked about are the window minus the delay: with 5 and 1 the run checks the
          4 working days before today. The delay always leaves at least one day to check, so it is
          capped at “window − 1”.
        </HelperMessage>

        <Inline space="space.200" alignBlock="start">
          <Stack space="space.050">
            <Label labelFor="run-times">Run times</Label>
            <Textfield
              id="run-times"
              width={260}
              value={form.runTimes}
              placeholder="09:00, 15:00"
              onChange={(e) => setForm((prev) => ({ ...prev, runTimes: e.target.value }))}
            />
            <HelperMessage>Reminders to the tracked people themselves.</HelperMessage>
          </Stack>
          <Stack space="space.050">
            <Label labelFor="manager-run-times">Manager run times</Label>
            <Textfield
              id="manager-run-times"
              width={260}
              value={form.managerRunTimes}
              placeholder="17:00"
              onChange={(e) => setForm((prev) => ({ ...prev, managerRunTimes: e.target.value }))}
            />
            <HelperMessage>
              Digests and all-clear notes to managers. Independent of the schedule on the left.
            </HelperMessage>
          </Stack>
        </Inline>
        <HelperMessage>
          24-hour clock in UTC, comma-separated. Each time fires at most once a day. The scheduled
          trigger wakes up once an hour, so a check starts at the first wake-up after the time you
          set{scheduleInfo?.catchUpMinutes ? `, and is dropped if that turns out to be more than ${scheduleInfo.catchUpMinutes} minutes late` : ''}.
          An empty field turns that mailing off — the Run check tab still sends both.
        </HelperMessage>

        {scheduleInfo && (
          <SectionMessage appearance="information">
            <Text>
              Now in {scheduleInfo.timeZone}: {scheduleInfo.now}.{' '}
              {scheduleInfo.nextRun
                ? `Next reminders: ${scheduleInfo.nextRun}.`
                : 'Reminders to people are off — the run times list is empty.'}{' '}
              {scheduleInfo.nextManagerRun
                ? `Next manager digests: ${scheduleInfo.nextManagerRun}.`
                : 'Manager digests are off — the manager run times list is empty.'}
            </Text>
          </SectionMessage>
        )}

        <Checkbox
          isChecked={form.skipWeekends}
          label="Don’t run the scheduled check on weekends"
          onChange={(e) => setForm((prev) => ({ ...prev, skipWeekends: e.target.checked }))}
        />

        <Inline space="space.200" alignBlock="start" grow="fill">
          <Box xcss={templateFieldStyles}>
            <Stack space="space.050">
              <Label labelFor="template">Reminder text</Label>
              <TextArea
                id="template"
                value={form.messageTemplate}
                onChange={(e) => setForm((prev) => ({ ...prev, messageTemplate: e.target.value }))}
              />
              <HelperMessage>
                Sent to the person who is missing time for at least one checked day. Placeholders:{' '}
                {'{name}'}, {'{from}'}, {'{to}'}, {'{days}'}, {'{missing}'} — the missing days,
                listed — and {'{missingCount}'} — how many of them.
              </HelperMessage>
            </Stack>
          </Box>
          <Box xcss={templateFieldStyles}>
            <Stack space="space.050">
              <Label labelFor="manager-template">Manager reminder text</Label>
              <TextArea
                id="manager-template"
                value={form.managerMessageTemplate}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, managerMessageTemplate: e.target.value }))
                }
              />
              <HelperMessage>
                Sent to a manager who has someone to chase. Placeholders: {'{name}'} — the
                manager’s own name — {'{from}'}, {'{to}'}, {'{days}'}, {'{count}'} — how many of
                their people are missing time — and {'{list}'} — those people, one per line, each
                with the days they’re missing.
              </HelperMessage>
            </Stack>
          </Box>
          <Box xcss={templateFieldStyles}>
            <Stack space="space.050">
              <Label labelFor="manager-all-clear-template">Manager all-clear text</Label>
              <TextArea
                id="manager-all-clear-template"
                value={form.managerAllClearTemplate}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, managerAllClearTemplate: e.target.value }))
                }
              />
              <HelperMessage>
                Sent to a manager whose people have all logged their time — every manager on the
                list gets a message, so silence never means a broken run. Placeholders: {'{name}'},{' '}
                {'{from}'}, {'{to}'}, {'{days}'} and {'{count}'} — how many people they manage.
              </HelperMessage>
            </Stack>
          </Box>
        </Inline>

        <Inline space="space.100">
          <LoadingButton appearance="primary" isLoading={isSavingSettings} onClick={saveSettings}>
            Save settings
          </LoadingButton>
        </Inline>
      </Stack>

      {message && (
        <SectionMessage appearance={message.appearance}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};
