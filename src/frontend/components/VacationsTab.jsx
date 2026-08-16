import React, { useState } from 'react';
import {
  Box,
  Checkbox,
  DynamicTable,
  Form,
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
import { formatInstant } from '../formatTime';
import { ConfirmDialog } from './ConfirmDialog';
import { Panel, TabHeader } from './layout';
import { useTransientMessage } from './useTransientMessage';

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
  // Успех гаснет сам, ошибка остаётся: см. useTransientMessage.
  const [message, setMessage] = useTransientMessage();
  const [test, setTest] = useState(null);
  // Адрес живёт в секретном хранилище и обратно не читается: удалили — значит идти
  // за ним в настройки календаря заново.
  const [isClearOpen, setIsClearOpen] = useState(false);

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

  const save = () => {
    // Enter в пустом поле форму отправляет, кнопка при этом заблокирована.
    if (icsUrl.trim().length === 0) return undefined;
    return withBusy('save', async () => {
      const result = await api.saveCredential('vacationIcsUrl', icsUrl);
      onCredentialsChange(result);
      setIcsUrl('');
      setTest(null);
      setMessage({ appearance: 'success', text: 'iCal address saved' });
    });
  };

  const clear = async () => {
    await withBusy('clear', async () => {
      const result = await api.clearCredential('vacationIcsUrl');
      onCredentialsChange(result);
      setTest(null);
      setMessage({ appearance: 'information', text: 'iCal address removed' });
    });
    setIsClearOpen(false);
  };

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
    <Stack space="space.200">
      <TabHeader
        title="Vacations"
        description="A day covered by a vacation is not a debt: it is removed from the person’s missing days, so neither they nor their manager is asked about it. If a vacation covers every day the app would have asked about, nothing is sent at all."
        message={message}
        actions={
          <LoadingButton isLoading={busy === 'test'} isDisabled={!status.isSet} onClick={runTest}>
            Test calendar
          </LoadingButton>
        }
      />

      <Panel title="When vacations are taken into account">
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

        {settings.skipVacations && !status.isSet && (
          <SectionMessage appearance="warning">
            <Text>
              The vacation calendar is on, but no iCal address is set — runs will ignore vacations
              and say so in the report.
            </Text>
          </SectionMessage>
        )}
      </Panel>

      <Panel title="Calendar link">
        <Inline space="space.100" alignBlock="center">
          <Label labelFor="vacation-ics-url">Secret address in iCal format</Label>
          {status.isSet ? (
            <Lozenge appearance="success">set: {status.maskedTail}</Lozenge>
          ) : (
            <Lozenge appearance="removed">not set</Lozenge>
          )}
        </Inline>
        {/* Форма ради Enter: Textfield в UI Kit не принимает onKeyDown. */}
        <Form onSubmit={save}>
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
              type="submit"
              isLoading={busy === 'save'}
              isDisabled={icsUrl.trim().length === 0}
            >
              Save
            </LoadingButton>
            {/* type="button": иначе кнопка внутри формы отправляет её. */}
            <LoadingButton
              appearance="subtle"
              type="button"
              isLoading={busy === 'clear'}
              isDisabled={!status.isSet}
              onClick={() => setIsClearOpen(true)}
            >
              Remove
            </LoadingButton>
          </Inline>
        </Form>
        <HelperMessage>
          Google Calendar → the vacation calendar → Settings → Integrate calendar → “Secret address
          in iCal format”. Anyone holding this link can read the calendar, so it is stored in Forge
          secret storage and never shown back. Note that Google serves this feed from a cache: a
          vacation entered a few minutes ago may take a while to appear here.
          {status.updatedAt ? ` Updated: ${formatInstant(status.updatedAt)}.` : ''}
        </HelperMessage>
        <HelperMessage>
          “Test calendar” in the header also shows how event titles map onto the tracked users: an
          employee written differently in the calendar than in Jira shows up as “no match”, and the
          fix is the “Name in the vacation calendar” column on the Users tab.
        </HelperMessage>
      </Panel>

      {test && (
        <Panel title="What the calendar returns">
          <TestResult test={test} />
        </Panel>
      )}

      <ConfirmDialog
        isOpen={isClearOpen}
        title="Remove the iCal address?"
        confirmLabel="Remove address"
        isBusy={busy === 'clear'}
        onConfirm={clear}
        onCancel={() => setIsClearOpen(false)}
      >
        <Stack space="space.100">
          <Text>
            The address is kept in Forge secret storage and is never shown back, so nothing here can
            restore it — you would have to copy it from the calendar settings again.
          </Text>
          <Text>
            {settings.skipVacations
              ? 'The vacation switch stays on, so runs will keep saying that vacations were ignored.'
              : 'Vacations are already off, so runs are unaffected until you turn them back on.'}
          </Text>
        </Stack>
      </ConfirmDialog>
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
