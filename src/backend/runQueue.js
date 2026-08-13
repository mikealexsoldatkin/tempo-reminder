import { Queue } from '@forge/events';
import { getRunStatus, setRunStatus } from './store.js';

export const RUN_QUEUE_KEY = 'reminder-run';

const queue = new Queue({ key: RUN_QUEUE_KEY });

/**
 * Прогон выполняется в async-консьюмере, а не в резолвере/триггере:
 * у консьюмера лимит 15 минут, а Tempo и Slack приходится опрашивать с паузами.
 */
export async function enqueueRun(trigger, requestedBy = null) {
  const status = await getRunStatus();
  if (status.state === 'queued' || status.state === 'running') {
    return {
      started: false,
      message: 'A run is already in progress — wait for it to finish',
      runStatus: status,
    };
  }

  const { jobId } = await queue.push({ body: { trigger, requestedBy } });
  const runStatus = await setRunStatus({ state: 'queued', jobId, trigger, requestedBy });
  return { started: true, message: 'The check has been queued', runStatus };
}
