import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  DynamicTable,
  Heading,
  Inline,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  ProgressBar,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  xcss,
} from '@forge/react';
import { api } from '../api';
import { formatInstant } from '../formatTime';
import { useTransientMessage } from './useTransientMessage';

const OUTCOME_VIEW = {
  reminded: { appearance: 'inprogress', label: 'reminder sent' },
  logged: { appearance: 'success', label: 'time logged' },
  notified: { appearance: 'inprogress', label: 'digest sent' },
  reported: { appearance: 'inprogress', label: 'report sent' },
  'all-clear': { appearance: 'success', label: 'all clear sent' },
  'on-leave': { appearance: 'moved', label: 'on leave' },
  'no-manager': { appearance: 'removed', label: 'no manager' },
  'no-email': { appearance: 'removed', label: 'no email' },
  'no-slack': { appearance: 'removed', label: 'not in Slack' },
  error: { appearance: 'removed', label: 'error' },
};

const REPORT_STATUS_VIEW = {
  ok: { appearance: 'success', label: 'completed' },
  skipped: { appearance: 'moved', label: 'skipped' },
  failed: { appearance: 'removed', label: 'failed' },
};

const POLL_INTERVAL_MS = 3000;

// Полоса своей ширины не имеет и растягивается по родителю — задаём её обёрткой.
const progressBarStyles = xcss({ width: '360px', maxWidth: '100%' });

/**
 * Чем прогон занят прямо сейчас. Фазы приходят из бэкенда (RUN_PHASE в
 * reminder.js); незнакомую покажем как есть, а не спрячем — новая фаза не повод
 * возвращать пользователя к безымянному «running…».
 */
const PHASE_LABEL = {
  worklogs: 'Reading worklogs from Tempo',
  vacations: 'Reading the vacation calendar',
  users: 'Messaging tracked users',
  managers: 'Sending manager digests',
  detailed: 'Sending detailed reports',
};

/**
 * Ход прогона: фаза, «сделано из скольких» и полоса.
 *
 * Пока прогресса нет (очередь, первые секунды консьюмера), полоса неопределённая:
 * рисовать 0 % там, где счёта ещё нет, значило бы врать про то, что ничего не
 * сделано. Компонент без хуков — его вызывает родитель, а не таблица, но правило
 * из PeopleTable.jsx удобно держать общим.
 */
const RunProgress = ({ runStatus }) => {
  const progress = runStatus?.progress ?? null;
  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  const hasCount = total > 0;
  const phase = progress ? PHASE_LABEL[progress.phase] ?? progress.phase : null;

  const text =
    runStatus.state === 'queued'
      ? 'Check is queued…'
      : phase
        ? `${phase}${hasCount ? `: ${done} of ${total}` : '…'}`
        : 'Check is running…';

  return (
    <Stack space="space.050">
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>{text}</Text>
      </Inline>
      <Box xcss={progressBarStyles}>
        <ProgressBar
          ariaLabel={text}
          isIndeterminate={!hasCount}
          value={hasCount ? done / total : 0}
        />
      </Box>
    </Stack>
  );
};

/**
 * Ручной запуск проверки в обход scheduledTrigger + отчёт последнего прогона.
 * Сама проверка идёт в очереди, поэтому статус подтягиваем поллингом.
 */
export const RunTab = ({
  runStatus,
  lastReport,
  trackedCount,
  detailedCount = 0,
  credentials,
  onRunStateChange,
}) => {
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // «Поставлено в очередь» — отчёт о нажатии кнопки, и жить он должен ровно
  // столько, сколько остаётся новостью: дальше про прогон рассказывают полоса
  // хода и отчёт под ней. Ошибка запуска, наоборот, остаётся.
  const [message, setMessage] = useTransientMessage();

  const isRunning = runStatus?.state === 'queued' || runStatus?.state === 'running';
  const tokensMissing = !credentials.tempoToken?.isSet || !credentials.slackBotToken?.isSet;
  // Детальные отчёты — подмножество отслеживаемых, поэтому проверять достаточно
  // один список: пуст он — проверять некого вообще.
  const nobodyToCheck = trackedCount === 0;

  const refresh = useCallback(async () => {
    try {
      onRunStateChange(await api.getRunState());
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    }
  }, [onRunStateChange]);

  // Пока прогон в очереди или выполняется — опрашиваем статус.
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isRunning, refresh]);

  // Прогон закончился — «поставлено в очередь» пора убрать: под ним уже лежит
  // отчёт этого самого прогона, и рядом с ним сообщение о постановке в очередь
  // читается как «идёт ещё один».
  const wasRunning = useRef(false);
  useEffect(() => {
    if (isRunning) {
      wasRunning.current = true;
    } else if (wasRunning.current) {
      wasRunning.current = false;
      setMessage(null);
    }
  }, [isRunning, setMessage]);

  const start = async () => {
    setIsConfirmOpen(false);
    setIsStarting(true);
    setMessage(null);
    try {
      const result = await api.startRun();
      onRunStateChange({ runStatus: result.runStatus, lastReport });
      setMessage({ appearance: result.started ? 'information' : 'warning', text: result.message });
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Stack space="space.300">
      <Stack space="space.150">
        <Heading as="h3" size="medium">Manual run</Heading>
        <Text>
          This button runs the same check as the schedule, but immediately: the app looks at every
          checked working day and sends a Slack DM to everyone who is missing time on at least one
          of them. The “weekend” and “once per day” limits don’t apply to a manual run.
        </Text>

        {tokensMissing && (
          <SectionMessage appearance="warning">
            <Text>Connect Slack and set the Tempo API token on the “Access” tab first.</Text>
          </SectionMessage>
        )}

        {nobodyToCheck && (
          <SectionMessage appearance="warning">
            <Text>Nobody is tracked yet — there is nobody to check.</Text>
          </SectionMessage>
        )}

        <Inline space="space.100" alignBlock="center">
          <LoadingButton
            appearance="primary"
            isLoading={isStarting}
            isDisabled={isRunning || tokensMissing || nobodyToCheck}
            onClick={() => setIsConfirmOpen(true)}
          >
            Start check
          </LoadingButton>
          <Button appearance="subtle" isDisabled={isStarting} onClick={refresh}>
            Refresh status
          </Button>
          {runStatus?.state === 'stale' && (
            <Lozenge appearance="removed">the run didn’t respond — try again</Lozenge>
          )}
        </Inline>

        {isRunning && <RunProgress runStatus={runStatus} />}

        {message && (
          <SectionMessage appearance={message.appearance}>
            <Text>{message.text}</Text>
          </SectionMessage>
        )}
      </Stack>

      <LastReport report={lastReport} />

      <ModalTransition>
        {isConfirmOpen && (
          <Modal onClose={() => setIsConfirmOpen(false)}>
            <ModalHeader>
              <ModalTitle appearance="warning">Send reminders?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Text>
                Real Slack messages will be sent to every tracked user (currently {trackedCount})
                who has no Tempo entries within the check window, and to every manager on the list —
                either a digest, or the “everyone has logged time” note. Managers also get a
                detailed report for each of the {detailedCount} people who have someone in the
                “detailed report” column. A manual run ignores both schedules and the weekday-only
                rule, and sends everything.
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setIsConfirmOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={start}>
                Run check
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
};

const LastReport = ({ report }) => {
  if (!report) {
    return (
      <Stack space="space.150">
        <Heading as="h3" size="medium">Last run</Heading>
        <Text>No checks have run yet.</Text>
      </Stack>
    );
  }

  const status = REPORT_STATUS_VIEW[report.status] ?? { appearance: 'default', label: report.status };
  const head = {
    cells: [
      { key: 'name', content: 'User' },
      { key: 'outcome', content: 'Outcome' },
      { key: 'detail', content: 'Details' },
    ],
  };
  const rows = (report.rows ?? []).map((row) => {
    const view = OUTCOME_VIEW[row.outcome] ?? { appearance: 'default', label: row.outcome };
    return {
      key: row.accountId,
      cells: [
        { key: 'name', content: <Text>{row.displayName}</Text> },
        { key: 'outcome', content: <Lozenge appearance={view.appearance}>{view.label}</Lozenge> },
        { key: 'detail', content: <Text>{row.detail}</Text> },
      ],
    };
  });

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">Last run</Heading>
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={status.appearance}>{status.label}</Lozenge>
        {/* В UTC, как окно и расписания рядом: местное время в этой же строке
            читалось бы как расхождение данных, а не как разница зон. */}
        <Text>{formatInstant(report.startedAt)}</Text>
        <Lozenge>{report.trigger === 'manual' ? 'manual' : 'scheduled'}</Lozenge>
        {report.window && (
          <Text>
            window {report.window.from} — {report.window.to}
          </Text>
        )}
        {report.requiredDays?.length > 0 && (
          <Text>
            days asked about: {report.requiredDays.length} ({report.requiredDays[0]} —{' '}
            {report.requiredDays[report.requiredDays.length - 1]})
          </Text>
        )}
      </Inline>
      <Text>{report.message}</Text>
      <Text>
        Checked: {report.totals.tracked}, logged time: {report.totals.logged}, reminders:{' '}
        {report.totals.reminded}, on leave: {report.totals.onLeave ?? 0}, skipped:{' '}
        {report.totals.skipped}, errors: {report.totals.failed}
      </Text>

      {/* Молчание календаря отпусков неотличимо от «отпусков нет», поэтому о том,
          что он не прочитался, отчёт говорит прямо: прогон в этом случае не
          останавливается, но людям в отпуске могли уйти напоминания. */}
      {report.vacations?.warning && (
        <SectionMessage appearance="warning">
          <Text>{report.vacations.warning}</Text>
        </SectionMessage>
      )}
      {report.truncatedRows > 0 && (
        <Text>Not all rows are shown: {report.truncatedRows} more hidden, see the full list in `forge logs`.</Text>
      )}
      {rows.length > 0 && (
        <Box>
          <DynamicTable head={head} rows={rows} rowsPerPage={20} />
        </Box>
      )}

      <ManagerDigests report={report} />
      <DetailedReports report={report} />
    </Stack>
  );
};

/**
 * Что ушло менеджерам. Отдельной таблицей, а не строками в общей: получатель здесь
 * менеджер, а колонка «сколько подчинённых» осмысленна только для него.
 */
const ManagerDigests = ({ report }) => {
  const totals = report.managerTotals;
  const managerRows = report.managerRows ?? [];
  if (!totals || (managerRows.length === 0 && !totals.withoutManager)) return null;

  const head = {
    cells: [
      { key: 'name', content: 'Manager' },
      { key: 'people', content: 'People to report' },
      { key: 'outcome', content: 'Outcome' },
      { key: 'detail', content: 'Details' },
    ],
  };
  const rows = managerRows.map((row) => {
    const view = OUTCOME_VIEW[row.outcome] ?? { appearance: 'default', label: row.outcome };
    return {
      key: row.accountId,
      cells: [
        { key: 'name', content: <Text>{row.displayName}</Text> },
        { key: 'people', content: <Text>{String(row.reportedCount ?? 0)}</Text> },
        { key: 'outcome', content: <Lozenge appearance={view.appearance}>{view.label}</Lozenge> },
        { key: 'detail', content: <Text>{row.detail}</Text> },
      ],
    };
  });

  return (
    <Stack space="space.100">
      <Heading as="h4" size="small">Manager digests</Heading>
      <Text>
        Managers: {totals.managers}, digests sent: {totals.notified}, all-clear notes sent:{' '}
        {totals.allClear ?? 0}, errors: {totals.failed}
      </Text>
      {totals.withoutManager > 0 && (
        <SectionMessage appearance="warning">
          <Text>
            {totals.withoutManager} of the people without Tempo entries have no manager assigned —
            nobody was told about them. Fill in the Managers column on the Users tab.
          </Text>
        </SectionMessage>
      )}
      {report.truncatedManagerRows > 0 && (
        <Text>Not all rows are shown: {report.truncatedManagerRows} more hidden.</Text>
      )}
      {rows.length > 0 && (
        <Box>
          <DynamicTable head={head} rows={rows} rowsPerPage={20} />
        </Box>
      )}
    </Stack>
  );
};

/**
 * Детальные отчёты: строка на пару «сотрудник — получатель», потому что и сообщение,
 * и его доставка у каждого получателя свои.
 */
const DetailedReports = ({ report }) => {
  const totals = report.detailedTotals;
  const detailedRows = report.detailedRows ?? [];
  if (!totals || (detailedRows.length === 0 && !totals.people)) return null;

  const head = {
    cells: [
      { key: 'name', content: 'Person' },
      { key: 'manager', content: 'Sent to' },
      { key: 'outcome', content: 'Outcome' },
      { key: 'detail', content: 'Details' },
    ],
  };
  const rows = detailedRows.map((row) => {
    const view = OUTCOME_VIEW[row.outcome] ?? { appearance: 'default', label: row.outcome };
    return {
      key: row.key ?? row.accountId,
      cells: [
        { key: 'name', content: <Text>{row.displayName}</Text> },
        { key: 'manager', content: <Text>{row.managerName ?? '—'}</Text> },
        { key: 'outcome', content: <Lozenge appearance={view.appearance}>{view.label}</Lozenge> },
        { key: 'detail', content: <Text>{row.detail}</Text> },
      ],
    };
  });

  return (
    <Stack space="space.100">
      <Heading as="h4" size="small">Detailed reports</Heading>
      <Text>
        Tracked in detail: {totals.people}, reports sent: {totals.sent}, errors: {totals.failed}
      </Text>
      {totals.withoutManager > 0 && (
        <SectionMessage appearance="warning">
          <Text>
            {totals.withoutManager} of them have no manager assigned — their reports went nowhere.
            Fill in the “Managers who get the detailed report” column on the Users tab.
          </Text>
        </SectionMessage>
      )}
      {report.truncatedDetailedRows > 0 && (
        <Text>Not all rows are shown: {report.truncatedDetailedRows} more hidden.</Text>
      )}
      {rows.length > 0 && (
        <Box>
          <DynamicTable head={head} rows={rows} rowsPerPage={20} />
        </Box>
      )}
    </Stack>
  );
};
