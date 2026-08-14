import React, { useState } from 'react';
import {
  Box,
  Checkbox,
  Heading,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
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

/**
 * Задержка не может съесть всё окно — иначе спрашивать было бы не о чем. Бэкенд
 * прижимает значение сам, здесь то же правило нужно лишь стрелкам в поле.
 */
const maxDelayFor = (lookbackWorkingDays) => {
  const lookback = Number(lookbackWorkingDays);
  return Number.isFinite(lookback) ? Math.max(lookback - 1, 0) : 0;
};

/**
 * Времена запуска хранятся массивом ('HH:MM'), а редактируются одной строкой —
 * бэкенд принимает и то, и другое, поэтому форма держит строку и не пытается
 * разбирать ввод на лету: нормализацию делает сервер и возвращает результат.
 */
const toForm = (settings) => ({
  ...settings,
  runTimes: (settings.runTimes ?? []).join(', '),
  managerRunTimes: (settings.managerRunTimes ?? []).join(', '),
});

/**
 * Что и когда проверяем: окно рабочих дней, допустимая задержка, расписания двух
 * рассылок и тексты сообщений. Все поля сохраняются одной кнопкой — бэкенд
 * нормализует значения и возвращает их обратно в форму.
 */
export const SettingsTab = ({ settings, schedule, onSettingsChange }) => {
  const [form, setForm] = useState(() => toForm(settings));
  const [scheduleInfo, setScheduleInfo] = useState(schedule ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const save = async () => {
    setIsSaving(true);
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
      setIsSaving(false);
    }
  };

  return (
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

      <Inline space="space.400" alignBlock="center" shouldWrap>
        <Checkbox
          isChecked={form.skipWeekends}
          label="Don’t run the scheduled check on weekends"
          onChange={(e) => setForm((prev) => ({ ...prev, skipWeekends: e.target.checked }))}
        />
        <Checkbox
          isChecked={form.skipHolidays}
          label="Take the holiday calendar into account"
          onChange={(e) => setForm((prev) => ({ ...prev, skipHolidays: e.target.checked }))}
        />
      </Inline>
      <HelperMessage>
        A holiday is not a working day: it never gets into the checked window, and the scheduled
        run is skipped on it. Manage the list on the “Holidays” tab.
      </HelperMessage>

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
        <LoadingButton appearance="primary" isLoading={isSaving} onClick={save}>
          Save settings
        </LoadingButton>
      </Inline>

      {message && (
        <SectionMessage appearance={message.appearance}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};
