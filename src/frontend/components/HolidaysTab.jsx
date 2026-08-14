import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  Heading,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Select,
  Stack,
  Text,
  Textfield,
  xcss,
} from '@forge/react';
import { api } from '../api';

// Select своей ширины не имеет и растягивается по родителю — задаём её обёрткой.
const WIDE = xcss({ width: '220px' });
const MEDIUM = xcss({ width: '180px' });
const NARROW = xcss({ width: '140px' });

/**
 * Праздники в приложении — это правила, а не даты: «последний понедельник мая»
 * должен оставаться верным и в следующем году. Отсюда две формы добавления,
 * а расшифровку правила и ближайшую дату считает бэкенд (см. describeHolidays).
 *
 * Списки подписей продублированы с backend/holidays.js намеренно: фронтенд Forge
 * собирается отдельным бандлом и импортировать бэкендовый модуль (он тянет KVS)
 * не может.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, index) => ({ label, value: index + 1 }));

// Значения как у Date#getUTCDay: 0 — воскресенье.
const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
].map((label, index) => ({ label, value: index }));

const POSITIONS = [
  { label: '1st', value: 1 },
  { label: '2nd', value: 2 },
  { label: '3rd', value: 3 },
  { label: '4th', value: 4 },
  { label: '5th', value: 5 },
  { label: 'Last', value: -1 },
];

const TYPES = [
  { label: 'Same date every year', value: 'fixed' },
  { label: 'Weekday of a month', value: 'nth-weekday' },
];

const EMPTY_FORM = {
  name: '',
  type: TYPES[0],
  month: MONTHS[0],
  day: '1',
  weekday: WEEKDAYS[1],
  position: POSITIONS[0],
  offsetDays: '0',
};

export const HolidaysTab = ({ holidays, skipHolidays, onHolidaysChange }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isBusy, setIsBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState(null);

  const isFixed = form.type.value === 'fixed';

  const set = (changes) => setForm((prev) => ({ ...prev, ...changes }));

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** @returns {Promise<boolean>} удалось ли — форма очищается только после успеха */
  const mutate = async (action, successText) => {
    setIsBusy(true);
    setMessage(null);
    try {
      const result = await action();
      onHolidaysChange(result.holidays);
      setSelected(new Set());
      setMessage({ appearance: 'success', text: successText });
      return true;
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const add = async () => {
    const holiday = isFixed
      ? { name: form.name, type: 'fixed', month: form.month.value, day: Number(form.day) }
      : {
          name: form.name,
          type: 'nth-weekday',
          month: form.month.value,
          weekday: form.weekday.value,
          nth: form.position.value,
          offsetDays: Number(form.offsetDays || 0),
        };

    // Введённое не стираем, если бэкенд не принял правило: иначе исправлять
    // опечатку пришлось бы, набирая всё заново.
    const added = await mutate(() => api.addHoliday(holiday), 'Holiday added');
    if (added) setForm((prev) => ({ ...EMPTY_FORM, type: prev.type }));
  };

  const head = {
    cells: [
      { key: 'select', content: '', width: 5 },
      { key: 'name', content: 'Holiday' },
      { key: 'when', content: 'Rule' },
      { key: 'next', content: 'Next date' },
      { key: 'actions', content: '', width: 10 },
    ],
  };

  const rows = holidays.map((holiday) => ({
    key: holiday.id,
    cells: [
      {
        key: 'select',
        content: (
          <Checkbox
            isChecked={selected.has(holiday.id)}
            onChange={() => toggle(holiday.id)}
            label=""
          />
        ),
      },
      { key: 'name', content: <Text>{holiday.name}</Text> },
      { key: 'when', content: <Text>{holiday.when}</Text> },
      {
        key: 'next',
        content: holiday.nextDate ? (
          <Text>{holiday.nextDate}</Text>
        ) : (
          <Lozenge appearance="removed">never happens</Lozenge>
        ),
      },
      {
        key: 'actions',
        content: (
          <Button
            appearance="subtle"
            iconBefore="trash"
            isDisabled={isBusy}
            onClick={() => mutate(() => api.removeHolidays([holiday.id]), 'Holiday removed')}
          >
            Remove
          </Button>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.300">
      <Stack space="space.150">
        <Heading as="h3" size="medium">Holiday calendar ({holidays.length})</Heading>
        <Text>
          A holiday is not a working day: nobody has to log time for it, and the scheduled check is
          skipped on it. Holidays are stored as rules, so “last Monday of May” stays correct next
          year too.
        </Text>

        {!skipHolidays && (
          <SectionMessage appearance="warning">
            <Text>
              “Take the holiday calendar into account” is off on the “Tokens and settings” tab, so
              this list changes nothing right now — holidays are treated as ordinary working days.
            </Text>
          </SectionMessage>
        )}

        {holidays.length === 0 && (
          <SectionMessage appearance="warning">
            <Text>The calendar is empty — only weekends will be skipped.</Text>
          </SectionMessage>
        )}

        {rows.length > 0 && (
          <Box>
            <DynamicTable head={head} rows={rows} rowsPerPage={20} isLoading={isBusy} />
          </Box>
        )}

        <Inline space="space.100">
          <LoadingButton
            appearance="danger"
            isLoading={isBusy}
            isDisabled={selected.size === 0}
            onClick={() => mutate(() => api.removeHolidays([...selected]), 'Holidays removed')}
          >
            Remove selected ({selected.size})
          </LoadingButton>
          <LoadingButton
            appearance="subtle"
            isLoading={isBusy}
            onClick={() => mutate(() => api.resetHolidays(), 'Default calendar restored')}
          >
            Restore defaults
          </LoadingButton>
        </Inline>
      </Stack>

      <Stack space="space.150">
        <Heading as="h4" size="small">Add a holiday</Heading>

        <Inline space="space.200" alignBlock="start" shouldWrap>
          <Stack space="space.050">
            <Label labelFor="holiday-name">Name</Label>
            <Textfield
              id="holiday-name"
              width={240}
              value={form.name}
              placeholder="Company day off"
              onChange={(e) => set({ name: e.target.value })}
            />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="holiday-type">Repeats</Label>
            <Box xcss={WIDE}>
              <Select
                id="holiday-type"
                options={TYPES}
                value={form.type}
                onChange={(option) => set({ type: option })}
              />
            </Box>
          </Stack>
        </Inline>

        {isFixed ? (
          <Inline space="space.200" alignBlock="start" shouldWrap>
            <Stack space="space.050">
              <Label labelFor="holiday-month">Month</Label>
              <Box xcss={MEDIUM}>
                <Select
                  id="holiday-month"
                  options={MONTHS}
                  value={form.month}
                  onChange={(option) => set({ month: option })}
                />
              </Box>
            </Stack>
            <Stack space="space.050">
              <Label labelFor="holiday-day">Day</Label>
              <Textfield
                id="holiday-day"
                type="number"
                width={100}
                min={1}
                max={31}
                value={form.day}
                onChange={(e) => set({ day: e.target.value })}
              />
            </Stack>
          </Inline>
        ) : (
          <Stack space="space.100">
            <Inline space="space.200" alignBlock="start" shouldWrap>
              <Stack space="space.050">
                <Label labelFor="holiday-position">Which one</Label>
                <Box xcss={NARROW}>
                  <Select
                    id="holiday-position"
                    options={POSITIONS}
                    value={form.position}
                    onChange={(option) => set({ position: option })}
                  />
                </Box>
              </Stack>
              <Stack space="space.050">
                <Label labelFor="holiday-weekday">Weekday</Label>
                <Box xcss={MEDIUM}>
                  <Select
                    id="holiday-weekday"
                    options={WEEKDAYS}
                    value={form.weekday}
                    onChange={(option) => set({ weekday: option })}
                  />
                </Box>
              </Stack>
              <Stack space="space.050">
                <Label labelFor="holiday-month-nth">Of month</Label>
                <Box xcss={MEDIUM}>
                  <Select
                    id="holiday-month-nth"
                    options={MONTHS}
                    value={form.month}
                    onChange={(option) => set({ month: option })}
                  />
                </Box>
              </Stack>
              <Stack space="space.050">
                <Label labelFor="holiday-offset">Shift, days</Label>
                <Textfield
                  id="holiday-offset"
                  type="number"
                  width={100}
                  min={-6}
                  max={6}
                  value={form.offsetDays}
                  onChange={(e) => set({ offsetDays: e.target.value })}
                />
              </Stack>
            </Inline>
            <HelperMessage>
              The shift is for days that hang off another holiday: the day after Thanksgiving is
              “4th Thursday of November + 1 day”, not the 4th Friday — in years that start November
              on a Friday those are different days.
            </HelperMessage>
          </Stack>
        )}

        <Inline space="space.100">
          <LoadingButton
            appearance="primary"
            isLoading={isBusy}
            isDisabled={form.name.trim().length === 0}
            onClick={add}
          >
            Add holiday
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
