import { handler as adminResolver } from './backend/resolvers.js';
import { enqueueRun } from './backend/runQueue.js';
import { resolveSkipReason, runReminderCheck } from './backend/reminder.js';
import { getSettings, saveLastReport, setRunStatus } from './backend/store.js';

/**
 * Точки входа приложения:
 *  - resolver    — страница настроек (jira:adminPage), см. src/backend/resolvers.js;
 *  - scheduled   — ежедневный триггер, ставит прогон в очередь;
 *  - runConsumer — консьюмер очереди, где прогон реально выполняется.
 *
 * Токены и список отслеживаемых пользователей живут в Forge KVS,
 * env-переменные приложение больше не использует.
 */

export const resolver = adminResolver;

/**
 * Плановый запуск. Выходные и «раз в день» проверяем ещё до постановки в очередь:
 * иначе каждый выходной создавался бы job, который только перетирал бы отчёт
 * последнего реального прогона. Тот же самый guard стоит и внутри прогона —
 * job может выполниться заметно позже, чем был поставлен.
 */
export async function scheduled() {
  const now = new Date();
  const skipReason = await resolveSkipReason('schedule', await getSettings(), now);
  if (skipReason) {
    console.log(skipReason);
    return;
  }

  const { message } = await enqueueRun('schedule');
  console.log(`Плановый прогон: ${message}`);
}

/**
 * Консьюмер очереди. Начиная с @forge/events v2 это обычная функция, получающая
 * AsyncEvent целиком (тело — в event.body), а не резолвер с именованным методом:
 * старая форма `resolver: {function, method}` ещё проходит валидацию манифеста,
 * но рантайм отклоняет push с 400 Bad Request.
 */
export async function runConsumer(event) {
  const body = event?.body ?? {};
  const trigger = body.trigger === 'manual' ? 'manual' : 'schedule';
  const requestedBy = body.requestedBy ?? null;
  const startedAt = new Date().toISOString();

  await setRunStatus({ state: 'running', trigger, requestedBy });

  try {
    const report = await runReminderCheck({ trigger, requestedBy });
    return { status: report.status };
  } catch (e) {
    // Наружу не бросаем: Forge повторил бы job, а часть DM уже могла уйти.
    // Вместо ретрая сохраняем отчёт об ошибке — его покажет страница настроек.
    console.error(`Прогон упал: ${e.stack ?? e.message}`);
    await saveLastReport({
      trigger,
      requestedBy,
      startedAt,
      finishedAt: new Date().toISOString(),
      window: null,
      status: 'failed',
      message: `Прогон прерван ошибкой: ${e.message}`,
      rows: [],
      totals: { tracked: 0, logged: 0, reminded: 0, skipped: 0, failed: 0 },
    });
    await setRunStatus({ state: 'idle', lastTrigger: trigger, lastStatus: 'failed' });
    return { status: 'failed' };
  }
}
