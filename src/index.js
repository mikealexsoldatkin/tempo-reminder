import { handler as adminResolver } from './backend/resolvers.js';
import { enqueueRun } from './backend/runQueue.js';
import { describeDue, evaluateSchedule, runReminderCheck } from './backend/reminder.js';
import { handleSlackOAuthCallback } from './backend/slackOAuth.js';
import { getSettings, saveLastReport, setRunStatus } from './backend/store.js';

/**
 * Точки входа приложения:
 *  - resolver           — страница настроек (jira:adminPage), см. src/backend/resolvers.js;
 *  - scheduled          — ежедневный триггер, ставит прогон в очередь;
 *  - runConsumer        — консьюмер очереди, где прогон реально выполняется;
 *  - slackOAuthCallback — веб-триггер, куда возвращается браузер после Slack.
 *
 * Токены и список отслеживаемых пользователей живут в Forge KVS. Переменные
 * окружения приложение использует ровно для одного — настроек своего
 * Slack-приложения (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_REDIRECT_URI):
 * они одни на все установки и задаются при сборке, а не администратором.
 */

export const resolver = adminResolver;

/**
 * Часовое срабатывание триггера. Само по себе оно ничего не значит: время рассылки
 * задаётся списком в настройках, и подавляющее большинство срабатываний должно
 * закончиться здесь же, ничего не делая.
 *
 * Расписание сверяется до постановки в очередь — иначе каждый час создавался бы job,
 * который только перетирал бы отчёт последнего реального прогона. Тот же guard стоит
 * и внутри прогона: job может выполниться заметно позже, чем был поставлен.
 */
export async function scheduled() {
  const schedule = await evaluateSchedule(await getSettings(), new Date());
  if (!schedule.shouldRun) {
    console.log(`Пропуск: ${schedule.reason}`);
    return;
  }

  const { message } = await enqueueRun('schedule');
  console.log(`Плановый прогон (${describeDue(schedule.due)}): ${message}`);
}

/**
 * Возврат из Slack. Обработчик разбирает запрос сам (в том числе отказ на экране
 * согласия) и всегда отвечает страницей — падать здесь нельзя: платформа показала
 * бы администратору голую ошибку веб-триггера вместо объяснения.
 */
export async function slackOAuthCallback(request) {
  try {
    return await handleSlackOAuthCallback(request);
  } catch (e) {
    console.error(`Колбэк Slack упал: ${e.stack ?? e.message}`);
    return {
      statusCode: 500,
      statusText: 'Error',
      headers: { 'Content-Type': ['text/plain; charset=utf-8'], 'Cache-Control': ['no-store'] },
      body: `Slack was not connected: ${e.message}`,
    };
  }
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
