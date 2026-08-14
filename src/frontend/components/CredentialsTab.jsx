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
} from '@forge/react';
import { api } from '../api';

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
const toForm = (settings) => ({ ...settings, runTimes: (settings.runTimes ?? []).join(', ') });

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
        <HelperMessage>The check window is the last N working days, including today.</HelperMessage>

        <Label labelFor="run-times">Run times</Label>
        <Textfield
          id="run-times"
          width={320}
          value={form.runTimes}
          placeholder="09:00, 15:00"
          onChange={(e) => setForm((prev) => ({ ...prev, runTimes: e.target.value }))}
        />
        <HelperMessage>
          24-hour clock in UTC, comma-separated. Each time fires at most once a day. The scheduled
          trigger wakes up once an hour, so a check starts at the first wake-up after the time you
          set{scheduleInfo?.catchUpMinutes ? `, and is dropped if that turns out to be more than ${scheduleInfo.catchUpMinutes} minutes late` : ''}.
          Leave the field empty to turn scheduled checks off — the Run check tab still works.
        </HelperMessage>

        {scheduleInfo && (
          <SectionMessage appearance="information">
            <Text>
              Now in {scheduleInfo.timeZone}: {scheduleInfo.now}.{' '}
              {scheduleInfo.nextRun
                ? `Next scheduled check: ${scheduleInfo.nextRun}.`
                : 'No scheduled checks — the run times list is empty.'}
            </Text>
          </SectionMessage>
        )}

        <Checkbox
          isChecked={form.skipWeekends}
          label="Don’t run the scheduled check on weekends"
          onChange={(e) => setForm((prev) => ({ ...prev, skipWeekends: e.target.checked }))}
        />

        <Label labelFor="template">Reminder text</Label>
        <TextArea
          id="template"
          value={form.messageTemplate}
          onChange={(e) => setForm((prev) => ({ ...prev, messageTemplate: e.target.value }))}
        />
        <HelperMessage>Placeholders: {'{name}'}, {'{from}'}, {'{to}'}, {'{days}'}.</HelperMessage>

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
