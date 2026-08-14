import React, { useRef, useState } from 'react';
import {
  Box,
  Heading,
  HelperMessage,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  TextArea,
  Textfield,
  xcss,
} from '@forge/react';
import { api } from '../api';

// TextArea тянется на всю ширину родителя и своей ширины не имеет, поэтому размер
// шаблонам задаёт обёртка, а не сами поля. width: '100%' + flexGrow внутри Inline
// означает «занять всё, что есть»: колонки равномерно ужимаются от полной ширины
// страницы и остаются одинаковыми, каких бы размеров ни было окно.
const templateFieldStyles = xcss({ width: '100%', flexGrow: 1 });

// Четыре числовых поля стоят одним рядом и делят ширину поровну. flexBasis держит
// нижнюю границу: на узком окне ряд переносится, а не сжимается в нечитаемое.
const fieldColumnStyles = xcss({ width: '100%', flexGrow: 1, flexBasis: '180px' });

/**
 * Задержка не может съесть всё окно — иначе спрашивать было бы не о чем. Бэкенд
 * прижимает значение сам, здесь то же правило нужно лишь стрелкам в поле.
 */
const maxDelayFor = (lookbackWorkingDays) => {
  const lookback = Number(lookbackWorkingDays);
  return Number.isFinite(lookback) ? Math.max(lookback - 1, 0) : 0;
};

/**
 * Форма держит всё строками, включая числа и списки времён: так значение из поля
 * сравнимо с сохранённым простым `===`, и «изменилось ли» решается без разбора
 * пользовательского ввода — разбирает его всё равно бэкенд.
 */
const toForm = (settings) => ({
  lookbackWorkingDays: String(settings.lookbackWorkingDays ?? ''),
  acceptableDelayDays: String(settings.acceptableDelayDays ?? ''),
  runTimes: (settings.runTimes ?? []).join(', '),
  managerRunTimes: (settings.managerRunTimes ?? []).join(', '),
  messageTemplate: settings.messageTemplate ?? '',
  managerMessageTemplate: settings.managerMessageTemplate ?? '',
  managerAllClearTemplate: settings.managerAllClearTemplate ?? '',
  detailedReportTemplate: settings.detailedReportTemplate ?? '',
});

const FIELD_LABELS = {
  lookbackWorkingDays: 'Working days to check',
  acceptableDelayDays: 'Acceptable days of delay',
  runTimes: 'Run times',
  managerRunTimes: 'Manager run times',
  messageTemplate: 'Reminder text',
  managerMessageTemplate: 'Manager reminder text',
  detailedReportTemplate: 'Detailed report text',
  managerAllClearTemplate: 'Manager all-clear text',
};

/**
 * Что и когда проверяем: окно рабочих дней, допустимая задержка, расписания двух
 * рассылок и тексты сообщений.
 *
 * Кнопки «Save» здесь нет — как и на вкладках Holidays и Vacations, изменение
 * применяется само. Момент сохранения — потеря фокуса, а не каждое нажатие
 * клавиши: сохранять на onChange значило бы слать резолверу запрос на букву и
 * пытаться разобрать «09:» как время посреди набора.
 *
 * Бэкенд нормализует значения («9, 15:30» → «09:00, 15:30») и прижимает их к
 * границам, поэтому в форму всегда возвращается то, что реально сохранилось, а
 * расхождение с введённым проговаривается вслух: молчаливо подменённое значение
 * — это ровно тот случай, когда пользователь уверен, что настроил одно, а работает
 * другое.
 */
export const SettingsTab = ({ settings, schedule, onSettingsChange }) => {
  const [form, setForm] = useState(() => toForm(settings));
  // Последнее известное состояние сервера: с ним сравниваем поле на blur и в него
  // откатываемся, если сохранение не прошло. Дублируется в ref, потому что
  // сохранение выполняется отложенно (см. queue) и к своему моменту закрытое в
  // замыкании состояние уже успевает устареть.
  const [saved, setSaved] = useState(() => toForm(settings));
  const savedRef = useRef(saved);
  const [scheduleInfo, setScheduleInfo] = useState(schedule ?? null);
  const [savingField, setSavingField] = useState(null);
  const [status, setStatus] = useState(null);

  const rememberSaved = (next) => {
    savedRef.current = next;
    setSaved(next);
  };

  // Сохранения выстраиваются в цепочку: saveSettings читает настройки целиком и
  // пишет их целиком, поэтому два параллельных запроса (быстрый переход между
  // полями) могли бы затереть друг друга.
  const queue = useRef(Promise.resolve());

  // Значение берём в момент blur, а не в момент выполнения: к моменту очереди
  // пользователь мог уже начать править соседнее поле.
  const commit = (field) => {
    const value = form[field];
    queue.current = queue.current.then(() => save(field, value)).catch(() => {});
  };

  const save = async (field, value) => {
    if (value === savedRef.current[field]) return;

    setSavingField(field);
    setStatus(null);
    try {
      const result = await api.saveSettings({ [field]: value });
      const next = toForm(result.settings);
      // Ожидали, что изменится только правленое поле; всё остальное, что приехало
      // другим, — это нормализация или зажатие, и о них надо сказать.
      const expected = { ...savedRef.current, [field]: value };
      const adjusted = Object.keys(FIELD_LABELS).filter((key) => next[key] !== expected[key]);

      setForm((prev) => ({ ...prev, ...next }));
      rememberSaved(next);
      setScheduleInfo(result.schedule ?? null);
      onSettingsChange(result.settings);
      setStatus(
        adjusted.length === 0
          ? { appearance: 'success', text: `${FIELD_LABELS[field]} saved.` }
          : {
              appearance: 'information',
              text: `Saved, with adjustments: ${adjusted
                .map((key) => `${FIELD_LABELS[key]} → “${next[key] || 'empty'}”`)
                .join('; ')}.`,
            }
      );
    } catch (e) {
      setForm((prev) => ({ ...prev, [field]: savedRef.current[field] }));
      setStatus({ appearance: 'error', text: `${FIELD_LABELS[field]} not saved: ${e.message}` });
    } finally {
      setSavingField(null);
    }
  };

  const edit = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const isDirty = Object.keys(FIELD_LABELS).some((key) => form[key] !== saved[key]);

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        <Heading as="h3" size="medium">Check parameters</Heading>
        {savingField ? (
          <Inline space="space.050" alignBlock="center">
            <Spinner size="small" />
            <Text>Saving…</Text>
          </Inline>
        ) : (
          <Lozenge appearance={isDirty ? 'inprogress' : 'success'}>
            {isDirty ? 'unsaved — click outside the field' : 'all changes saved'}
          </Lozenge>
        )}
      </Inline>
      <HelperMessage>
        There is no Save button: every field is saved when you click out of it.
      </HelperMessage>

      <Inline space="space.200" alignBlock="start" shouldWrap>
        <Box xcss={fieldColumnStyles}>
          <Stack space="space.050">
            <Label labelFor="lookback">Working days to check</Label>
            <Textfield
              id="lookback"
              type="number"
              min={1}
              max={30}
              value={form.lookbackWorkingDays}
              onChange={edit('lookbackWorkingDays')}
              onBlur={() => commit('lookbackWorkingDays')}
            />
            <HelperMessage>
              The whole window: the last N working days, including today. Weekends are skipped.
            </HelperMessage>
          </Stack>
        </Box>
        <Box xcss={fieldColumnStyles}>
          <Stack space="space.050">
            <Label labelFor="acceptable-delay">Acceptable days of delay</Label>
            <Textfield
              id="acceptable-delay"
              type="number"
              min={0}
              max={maxDelayFor(form.lookbackWorkingDays)}
              value={form.acceptableDelayDays}
              onChange={edit('acceptableDelayDays')}
              onBlur={() => commit('acceptableDelayDays')}
            />
            <HelperMessage>
              How many of the most recent working days are excused. 0 means today’s time is already
              expected. Capped at “window − 1”.
            </HelperMessage>
          </Stack>
        </Box>
        <Box xcss={fieldColumnStyles}>
          <Stack space="space.050">
            <Label labelFor="run-times">Run times</Label>
            <Textfield
              id="run-times"
              value={form.runTimes}
              placeholder="09:00, 15:00"
              onChange={edit('runTimes')}
              onBlur={() => commit('runTimes')}
            />
            <HelperMessage>Reminders to the tracked people themselves.</HelperMessage>
          </Stack>
        </Box>
        <Box xcss={fieldColumnStyles}>
          <Stack space="space.050">
            <Label labelFor="manager-run-times">Manager run times</Label>
            <Textfield
              id="manager-run-times"
              value={form.managerRunTimes}
              placeholder="17:00"
              onChange={edit('managerRunTimes')}
              onBlur={() => commit('managerRunTimes')}
            />
            <HelperMessage>
              Digests, all-clear notes and detailed reports. Detailed reports also skip weekends.
            </HelperMessage>
          </Stack>
        </Box>
      </Inline>

      <HelperMessage>
        Time has to be logged for every working day of the window, not just for some of them. The
        days actually asked about are the window minus the delay: with 5 and 1 the run checks the 4
        working days before today. Run times use a 24-hour clock in UTC, comma-separated; each time
        fires at most once a day. The scheduled trigger wakes up once an hour, so a check starts at
        the first wake-up after the time you set
        {scheduleInfo?.catchUpMinutes
          ? `, and is dropped if that turns out to be more than ${scheduleInfo.catchUpMinutes} minutes late`
          : ''}
        . An empty field turns that mailing off — the Run check tab still sends both. Whether
        weekends and holidays are skipped is decided by the switches on the “Holidays” tab.
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

      <Inline space="space.200" alignBlock="start" grow="fill" shouldWrap>
        <Box xcss={templateFieldStyles}>
          <Stack space="space.050">
            <Label labelFor="template">Reminder text</Label>
            <TextArea
              id="template"
              value={form.messageTemplate}
              onChange={edit('messageTemplate')}
              onBlur={() => commit('messageTemplate')}
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
              onChange={edit('managerMessageTemplate')}
              onBlur={() => commit('managerMessageTemplate')}
            />
            <HelperMessage>
              Sent to a manager who has someone to chase — the people with that manager in the
              “basic report” column. Placeholders: {'{name}'} — the manager’s own name — {'{from}'},{' '}
              {'{to}'}, {'{days}'}, {'{count}'} — how many of their people are missing time — and{' '}
              {'{list}'} — those people, one per line, each with the days they’re missing.
            </HelperMessage>
          </Stack>
        </Box>
        <Box xcss={templateFieldStyles}>
          <Stack space="space.050">
            <Label labelFor="detailed-template">Detailed report text</Label>
            <TextArea
              id="detailed-template"
              value={form.detailedReportTemplate}
              onChange={edit('detailedReportTemplate')}
              onBlur={() => commit('detailedReportTemplate')}
            />
            <HelperMessage>
              One message per person who has anyone in the “detailed report” column, sent to each of
              those managers on the schedule above — on weekdays only. Placeholders: {'{name}'} —
              the manager’s own name — {'{user}'} — whose report it is — {'{from}'}, {'{to}'},{' '}
              {'{days}'} and {'{report}'} — the day-by-day breakdown, one date per line with the
              hours logged, the issue key, the Tempo work attribute and the worklog description.
            </HelperMessage>
          </Stack>
        </Box>
        <Box xcss={templateFieldStyles}>
          <Stack space="space.050">
            <Label labelFor="manager-all-clear-template">Manager all-clear text</Label>
            <TextArea
              id="manager-all-clear-template"
              value={form.managerAllClearTemplate}
              onChange={edit('managerAllClearTemplate')}
              onBlur={() => commit('managerAllClearTemplate')}
            />
            <HelperMessage>
              Sent to a manager whose people have all logged their time — every manager on the list
              gets a message, so silence never means a broken run. Placeholders: {'{name}'},{' '}
              {'{from}'}, {'{to}'}, {'{days}'} and {'{count}'} — how many people they manage.
            </HelperMessage>
          </Stack>
        </Box>
      </Inline>

      {status && (
        <SectionMessage appearance={status.appearance}>
          <Text>{status.text}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};
