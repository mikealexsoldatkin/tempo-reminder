import React, { useState } from 'react';
import {
  Box,
  Checkbox,
  DynamicTable,
  Heading,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';

/**
 * Календарь отпусков. Отпускной день не долг: за него не спрашивают ни сотрудника,
 * ни его менеджера.
 *
 * Доступ — по «Secret address in iCal format» из настроек корпоративного календаря.
 * Ссылка сама себе пароль, поэтому обращается с ней UI так же, как с токенами:
 * поле password, значение уходит в секретное хранилище и наружу не возвращается.
 */
export const VacationsTab = ({ settings, credentials, onSettingsChange, onCredentialsChange }) => {
  const [icsUrl, setIcsUrl] = useState('');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [test, setTest] = useState(null);

  const status = credentials.vacationIcsUrl ?? { isSet: false };

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

  const save = () =>
    withBusy('save', async () => {
      const result = await api.saveCredential('vacationIcsUrl', icsUrl);
      onCredentialsChange(result.credentials);
      setIcsUrl('');
      setTest(null);
      setMessage({ appearance: 'success', text: 'iCal address saved' });
    });

  const clear = () =>
    withBusy('clear', async () => {
      const result = await api.clearCredential('vacationIcsUrl');
      onCredentialsChange(result.credentials);
      setTest(null);
      setMessage({ appearance: 'information', text: 'iCal address removed' });
    });

  const toggleSetting = (patch) =>
    withBusy('toggle', async () => {
      const result = await api.saveSettings(patch);
      onSettingsChange(result.settings);
    });

  const runTest = () =>
    withBusy('test', async () => {
      setTest(await api.testVacationCalendar());
    });

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading as="h3" size="medium">Vacations</Heading>
        <Text>
          A day covered by a vacation is not a debt: it is removed from the person’s missing days, so
          neither they nor their manager is asked about it. If a vacation covers every day the app
          would have asked about, nothing is sent at all.
        </Text>
        <Checkbox
          isChecked={settings.skipVacations}
          isDisabled={busy !== null}
          label="Take the vacation calendar into account"
          onChange={(e) => toggleSetting({ skipVacations: e.target.checked })}
        />
        <Checkbox
          isChecked={settings.skipDmWhileOnLeave}
          isDisabled={busy !== null || !settings.skipVacations}
          label="Don’t message a person while they are on leave, even if older days are missing"
          onChange={(e) => toggleSetting({ skipDmWhileOnLeave: e.target.checked })}
        />
        <HelperMessage>
          Both switches are saved right away. The second one only holds back the DM — the person
          still appears in their manager’s digest, so the days aren’t forgotten.
        </HelperMessage>
      </Stack>

      {settings.skipVacations && !status.isSet && (
        <SectionMessage appearance="warning">
          <Text>
            The vacation calendar is on, but no iCal address is set — runs will ignore vacations and
            say so in the report.
          </Text>
        </SectionMessage>
      )}

      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Label labelFor="vacation-ics-url">Secret address in iCal format</Label>
          {status.isSet ? (
            <Lozenge appearance="success">set: {status.maskedTail}</Lozenge>
          ) : (
            <Lozenge appearance="removed">not set</Lozenge>
          )}
        </Inline>
        <Inline space="space.100" alignBlock="end">
          <Textfield
            id="vacation-ics-url"
            type="password"
            width={420}
            value={icsUrl}
            placeholder={status.isSet ? 'Enter a new address to replace it' : 'https://calendar.google.com/calendar/ical/…/basic.ics'}
            onChange={(e) => setIcsUrl(e.target.value)}
          />
          <LoadingButton
            appearance="primary"
            isLoading={busy === 'save'}
            isDisabled={icsUrl.trim().length === 0}
            onClick={save}
          >
            Save
          </LoadingButton>
          <LoadingButton
            appearance="subtle"
            isLoading={busy === 'clear'}
            isDisabled={!status.isSet}
            onClick={clear}
          >
            Remove
          </LoadingButton>
        </Inline>
        <HelperMessage>
          Google Calendar → the vacation calendar → Settings → Integrate calendar → “Secret address
          in iCal format”. Anyone holding this link can read the calendar, so it is stored in Forge
          secret storage and never shown back. Note that Google serves this feed from a cache: a
          vacation entered a few minutes ago may take a while to appear here.
          {status.updatedAt ? ` Updated: ${new Date(status.updatedAt).toLocaleString()}.` : ''}
        </HelperMessage>
      </Stack>

      <Stack space="space.150">
        <Inline space="space.100">
          <LoadingButton isLoading={busy === 'test'} isDisabled={!status.isSet} onClick={runTest}>
            Test connection
          </LoadingButton>
        </Inline>
        <HelperMessage>
          The test also shows how event titles map onto the tracked users: an employee written
          differently in the calendar than in Jira shows up here as “no match”, and the fix is the
          “Name in the vacation calendar” column on the Users tab.
        </HelperMessage>
        {test && <TestResult test={test} />}
      </Stack>

      {message && (
        <SectionMessage appearance={message.appearance}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};

const TestResult = ({ test }) => {
  if (!test.ok) {
    return (
      <SectionMessage appearance="error">
        <Text>{test.message}</Text>
      </SectionMessage>
    );
  }

  const head = {
    cells: [
      { key: 'title', content: 'Event' },
      { key: 'dates', content: 'Days' },
      { key: 'match', content: 'Matched' },
    ],
  };
  const rows = (test.upcoming ?? []).map((event, index) => ({
    key: `${event.from}-${index}`,
    cells: [
      { key: 'title', content: <Text>{event.title}</Text> },
      {
        key: 'dates',
        content: <Text>{event.from === event.to ? event.from : `${event.from} — ${event.to}`}</Text>,
      },
      {
        key: 'match',
        content: (
          <Lozenge appearance={event.matched ? 'success' : 'default'}>
            {event.matched ? 'tracked user' : 'no match'}
          </Lozenge>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.100">
      <SectionMessage appearance="success">
        <Text>{test.message}</Text>
      </SectionMessage>

      {test.onLeaveToday?.length > 0 && (
        <Text>On leave today: {test.onLeaveToday.join(', ')}.</Text>
      )}

      {test.recurringSkipped > 0 && (
        <SectionMessage appearance="warning">
          <Text>
            {test.recurringSkipped} repeating events were ignored — the app doesn’t expand recurring
            events, so a vacation entered as a repeating event won’t be seen.
          </Text>
        </SectionMessage>
      )}

      {rows.length > 0 && (
        <Stack space="space.050">
          <Heading as="h4" size="small">Upcoming events</Heading>
          <Box>
            <DynamicTable head={head} rows={rows} rowsPerPage={15} />
          </Box>
        </Stack>
      )}

      {test.unmatched?.length > 0 && (
        <Stack space="space.050">
          <Heading as="h4" size="small">
            Titles that matched nobody ({test.unmatchedTotal})
          </Heading>
          <Text>
            These are fine to ignore if they aren’t about tracked people. If one of them is an
            employee, add that spelling in the “Name in the vacation calendar” column.
          </Text>
          {test.unmatched.map((item) => (
            <Text key={item.title}>
              • {item.title}
              {item.count > 1 ? ` (×${item.count})` : ''}
            </Text>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
