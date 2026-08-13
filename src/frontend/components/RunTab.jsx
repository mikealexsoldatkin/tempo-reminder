import React, { useCallback, useEffect, useState } from 'react';
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
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { api } from '../api';

const OUTCOME_VIEW = {
  reminded: { appearance: 'inprogress', label: 'reminder sent' },
  logged: { appearance: 'success', label: 'time logged' },
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

/**
 * Ручной запуск проверки в обход scheduledTrigger + отчёт последнего прогона.
 * Сама проверка идёт в очереди, поэтому статус подтягиваем поллингом.
 */
export const RunTab = ({ runStatus, lastReport, trackedCount, credentials, onRunStateChange }) => {
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [message, setMessage] = useState(null);

  const isRunning = runStatus?.state === 'queued' || runStatus?.state === 'running';
  const tokensMissing = !credentials.tempoToken?.isSet || !credentials.slackBotToken?.isSet;

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
          This button runs the same check as the schedule, but immediately: the app compares tracked
          users against their Tempo worklogs and sends a Slack DM to everyone who hasn’t logged time.
          The “weekend” and “once per day” limits don’t apply to a manual run.
        </Text>

        {tokensMissing && (
          <SectionMessage appearance="warning">
            <Text>Set the Tempo API token and the Slack bot token on the “Tokens and settings” tab first.</Text>
          </SectionMessage>
        )}

        {trackedCount === 0 && (
          <SectionMessage appearance="warning">
            <Text>The tracked users list is empty — there is nobody to check.</Text>
          </SectionMessage>
        )}

        <Inline space="space.100" alignBlock="center">
          <LoadingButton
            appearance="primary"
            isLoading={isStarting}
            isDisabled={isRunning || tokensMissing || trackedCount === 0}
            onClick={() => setIsConfirmOpen(true)}
          >
            Start check
          </LoadingButton>
          <Button appearance="subtle" isDisabled={isStarting} onClick={refresh}>
            Refresh status
          </Button>
          {isRunning && (
            <Inline space="space.100" alignBlock="center">
              <Spinner size="small" />
              <Text>
                {runStatus.state === 'queued' ? 'Check is queued…' : 'Check is running…'}
              </Text>
            </Inline>
          )}
          {runStatus?.state === 'stale' && (
            <Lozenge appearance="removed">the run didn’t respond — try again</Lozenge>
          )}
        </Inline>

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
                who has no Tempo entries within the check window.
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
        <Text>{new Date(report.startedAt).toLocaleString()}</Text>
        <Lozenge>{report.trigger === 'manual' ? 'manual' : 'scheduled'}</Lozenge>
        {report.window && (
          <Text>
            window {report.window.from} — {report.window.to}
          </Text>
        )}
      </Inline>
      <Text>{report.message}</Text>
      <Text>
        Checked: {report.totals.tracked}, logged time: {report.totals.logged}, reminders:{' '}
        {report.totals.reminded}, skipped: {report.totals.skipped}, errors: {report.totals.failed}
      </Text>
      {report.truncatedRows > 0 && (
        <Text>Not all rows are shown: {report.truncatedRows} more hidden, see the full list in `forge logs`.</Text>
      )}
      {rows.length > 0 && (
        <Box>
          <DynamicTable head={head} rows={rows} rowsPerPage={20} />
        </Box>
      )}
    </Stack>
  );
};
