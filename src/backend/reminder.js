import {
  cacheManagerSlackUserIds,
  cacheSlackUserIds,
  getCredentials,
  getHandledRunTimes,
  getHolidays,
  getManagers,
  getSettings,
  getTrackedUsers,
  markRunTimesHandled,
  saveLastReport,
  setRunProgress,
  setRunStatus,
} from './store.js';
import { getUserWorklogs, getWorklogDaysByAuthor, sleep } from './tempo.js';
import { getIssues } from './jira.js';
import { lookupSlackUserByEmail, sendSlackDm } from './slack.js';
import { daysToReport, isWeekend, lastWorkingDays, windowOf } from './workdays.js';
import {
  CATCH_UP_MINUTES,
  SCHEDULE_TIME_ZONE,
  dayParts,
  dueRunTimes,
  formatClock,
  nextRunTime,
} from './schedule.js';
import { makeHolidayChecker } from './holidays.js';
import { getVacationDays } from './vacationCalendar.js';
import { excludeVacationDays } from './vacations.js';
import {
  countManagedPeople,
  countWithoutManager,
  groupByManager,
  renderDetailedReportMessage,
  renderManagerAllClearMessage,
  renderManagerMessage,
  renderUserMessage,
} from './notifications.js';
import { buildDailyReport, formatDailyReport } from './dailyReport.js';

export const OUTCOME = {
  reminded: 'reminded',
  logged: 'logged',
  notified: 'notified',
  allClear: 'all-clear',
  onLeave: 'on-leave',
  reported: 'reported',
  noManager: 'no-manager',
  noEmail: 'no-email',
  noSlack: 'no-slack',
  error: 'error',
};

/**
 * Две независимые рассылки с раздельными расписаниями: напоминания самим
 * сотрудникам и дайджесты их менеджерам. Детальные отчёты своего расписания не
 * имеют — они уходят вместе с менеджерскими и отдельным видом слота не считаются.
 */
export const RUN_KIND = { users: 'users', managers: 'managers' };

// Паузы, чтобы не упереться в rate limit Slack (lookupByEmail — Tier 3, postMessage — ~1 msg/s).
const SLACK_LOOKUP_PAUSE_MS = 200;
const SLACK_SEND_PAUSE_MS = 300;
// Детальные отчёты идут по запросу на человека — шлюз Tempo режет на ~5 req/s.
const TEMPO_USER_PAUSE_MS = 250;

/**
 * Как часто прогон отмечается в статусе. Страница опрашивает его раз в три
 * секунды, так что писать чаще незачем: это лишние записи в KVS на каждого
 * человека и ничего сверх того, что уже видно на экране.
 */
const PROGRESS_THROTTLE_MS = 2000;

export const RUN_PHASE = {
  worklogs: 'worklogs',
  vacations: 'vacations',
  users: 'users',
  managers: 'managers',
  detailed: 'detailed',
};

/**
 * Отметки прогресса: где прогон сейчас и сколько из скольких сделано.
 *
 * Смена фазы пишется всегда, шаги внутри фазы — не чаще, чем раз в
 * PROGRESS_THROTTLE_MS. Пропущенный из-за этого последний шаг фазы не страшен:
 * следующая фаза перепишет отметку целиком, а последняя — завершение прогона.
 *
 * Ошибка записи проглатывается: прогресс — это удобство, из-за которого рассылка
 * падать не должна.
 */
function makeProgressReporter() {
  let lastWriteAt = 0;
  return async function report(phase, { done = 0, total = 0, force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastWriteAt < PROGRESS_THROTTLE_MS) return;
    lastWriteAt = now;
    try {
      await setRunProgress({ phase, done, total });
    } catch (e) {
      console.warn(`Не удалось записать прогресс (${phase}): ${e.message}`);
    }
  };
}

/**
 * Один прогон проверки: кто из отслеживаемых пользователей не репортился в Tempo
 * за последние N рабочих дней. Такому человеку уходит DM, а его менеджерам —
 * дайджест со списком подчинённых. Вместе с дайджестами уходят детальные отчёты
 * по тем, кому проставлены получатели детального отчёта: по одному сообщению на
 * человека, с разбором окна по дням. Что именно рассылать, решает расписание;
 * ручной запуск делает всё сразу.
 *
 * @param {{ trigger: 'schedule'|'manual', requestedBy?: string|null, now?: Date }} options
 */
export async function runReminderCheck({ trigger, requestedBy = null, now = new Date() }) {
  const startedAt = new Date(now).toISOString();
  const settings = await getSettings();
  // Праздник — не рабочий день: время за него не спрашивается, и планового прогона
  // в этот день нет. Выключенная галочка превращает календарь в справочный список.
  const isHoliday = settings.skipHolidays ? makeHolidayChecker(await getHolidays()) : () => null;

  // Плановый прогон ещё раз сверяется с расписанием: job мог пролежать в очереди
  // дольше, чем предполагалось при постановке. Ручной запуск расписанию не подчиняется.
  const schedule = trigger === 'schedule' ? await evaluateSchedule(settings, now, isHoliday) : null;
  if (schedule && !schedule.shouldRun) {
    return finish({ trigger, requestedBy, startedAt, status: 'skipped', message: schedule.reason });
  }

  const today = schedule?.date ?? dayParts(now).date;
  // Детальные отчёты отдельного расписания не имеют — они уходят вместе с дайджестами
  // менеджерам. Но только по будням: разбор рабочей недели, пришедший в субботу,
  // менеджеру не нужен, а к понедельнику он всё равно повторится.
  const targets = schedule
    ? {
        users: schedule.due[RUN_KIND.users].length > 0,
        managers: schedule.due[RUN_KIND.managers].length > 0,
        detailed: schedule.due[RUN_KIND.managers].length > 0 && !isWeekend(today),
      }
    : { users: true, managers: true, detailed: true };
  // Проверяем каждый рабочий день окна по отдельности, но за самые свежие дни
  // время ещё могут не успеть занести — их прощает «acceptable delay».
  let checkedDays;
  try {
    checkedDays = lastWorkingDays(today, settings.lookbackWorkingDays, isHoliday);
  } catch (e) {
    return finish({ trigger, requestedBy, startedAt, status: 'failed', message: e.message }, schedule);
  }
  const requiredDays = daysToReport(checkedDays, settings.acceptableDelayDays);
  const window = windowOf(checkedDays);
  // Настройки нормализуются на чтении и такого не допускают; проверка здесь на
  // случай, если правило «задержка меньше окна» когда-нибудь ослабнет.
  if (requiredDays.length === 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'skipped',
      message: 'The acceptable delay covers the whole window — there is nothing to check',
    }, schedule);
  }

  const users = await getTrackedUsers();
  // Детальный отчёт — не отдельный список людей, а глубина слежки за теми же
  // отслеживаемыми: его получают менеджеры, проставленные человеку во второй
  // колонке. Никого не проставили — разбирать по дням некому и незачем.
  const detailedUsers = users.filter((user) => (user.detailedManagerIds ?? []).length > 0);
  if (users.length === 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'skipped',
      message: 'The tracked users list is empty — add users in the app settings',
    }, schedule);
  }

  const { tempoToken, slackBotToken, vacationIcsUrl } = await getCredentials();
  const missing = [
    !tempoToken && 'Tempo API token',
    !slackBotToken && 'Slack bot token',
  ].filter(Boolean);
  if (missing.length > 0) {
    return finish({
      trigger,
      requestedBy,
      startedAt,
      window,
      status: 'failed',
      message: `Missing tokens: ${missing.join(', ')} — set them in the app settings`,
    }, schedule);
  }

  console.log(
    `Прогон (${trigger}${schedule ? `, слоты ${describeDue(schedule.due)}` : ''}): ` +
      `окно ${window.from}..${window.to} (${checkedDays.length} раб. дн.), ` +
      `спрашиваем ${requiredDays.length}: ${requiredDays.join(', ')}; ` +
      `отслеживается ${users.length} чел., детально ${detailedUsers.length}, ` +
      `рассылка: ${
        [
          targets.users && 'сотрудникам',
          targets.managers && 'менеджерам',
          targets.detailed && 'детальные отчёты',
        ]
          .filter(Boolean)
          .join(', ') || '—'
      }`
  );

  // Тянем из Tempo только спрашиваемые дни: за прощённые записи всё равно не
  // проверяются, а лишние страницы — это лишние запросы к шлюзу с rate limit'ом.
  // Пустой список отслеживаемых пропускает запрос целиком: он прокачивает через
  // себя worklog'и всего инстанса, а сверять их будет не с кем. Детальные отчёты
  // от него не зависят — они ходят за записями конкретного человека.
  const progress = makeProgressReporter();

  const fetchRange = windowOf(requiredDays);
  let daysByAuthor = new Map();
  if (users.length > 0) {
    await progress(RUN_PHASE.worklogs, { total: users.length, force: true });
    try {
      daysByAuthor = await getWorklogDaysByAuthor(fetchRange.from, fetchRange.to, tempoToken);
    } catch (e) {
      return finish({
        trigger,
        requestedBy,
        startedAt,
        window,
        status: 'failed',
        message: `Couldn’t fetch worklogs from Tempo: ${e.message}`,
      }, schedule);
    }
    console.log(`Tempo: ${daysByAuthor.size} авторов с записями в окне`);
  }

  // Дни без записей у каждого отслеживаемого — считаем один раз: они нужны и для
  // самих напоминаний, и для списка в дайджесте менеджеру, и для отчёта.
  const missingBeforeVacations = new Map(
    users.map((user) => {
      const reported = daysByAuthor.get(user.accountId) ?? new Set();
      return [user.accountId, requiredDays.filter((day) => !reported.has(day))];
    })
  );

  // Отпускной день — не долг: за него не спрашивают ни сотрудника, ни менеджера.
  // Календарь читается до отправки, чтобы такие дни исчезли из пропущенных ещё
  // до того, как кто-то попадёт в список должников.
  //
  // Окно берём целиком, а не только спрашиваемые дни: пустые дни в детальном
  // отчёте тоже должны объясняться отпуском, а он захватывает и самые свежие дни.
  await progress(RUN_PHASE.vacations, { force: true });
  const vacations = await loadVacations({
    settings,
    users,
    icsUrl: vacationIcsUrl,
    range: { from: window.from, to: today },
  });
  const { missingDaysByUser, excusedDaysByUser } = excludeVacationDays(
    missingBeforeVacations,
    vacations.daysByPerson
  );
  const unreported = users.filter((user) => missingDaysByUser.get(user.accountId).length > 0);

  const rows = targets.users
    ? await remindUsers({
        users,
        missingDaysByUser,
        excusedDaysByUser,
        vacationDaysByPerson: vacations.daysByPerson,
        today,
        requiredDays,
        window,
        settings,
        slackBotToken,
        progress,
      })
    : [];
  const managerRows = targets.managers
    ? await notifyManagers({
        users,
        unreported,
        missingDaysByUser,
        window,
        settings,
        slackBotToken,
        progress,
      })
    : [];
  const detailedRows = targets.detailed
    ? await sendDetailedReports({
        detailedUsers,
        vacationDaysByPerson: vacations.daysByPerson,
        window,
        settings,
        isHoliday,
        tempoToken,
        slackBotToken,
        progress,
      })
    : [];

  const totals = countUserOutcomes(rows);
  // Если дайджесты в этот прогон не рассылались, счётчик «без менеджера» тоже
  // не считаем: иначе отчёт о рассылке сотрудникам предупреждал бы о менеджерах.
  const managerTotals = countManagerOutcomes(managerRows, targets.managers ? unreported : []);
  const detailedTotals = countDetailedOutcomes(
    detailedRows,
    targets.detailed ? detailedUsers.length : 0
  );
  console.log(
    `Готово. Напоминаний: ${totals.reminded}, дайджестов: ${managerTotals.notified}, ` +
      `«всё в порядке»: ${managerTotals.allClear}, детальных отчётов: ${detailedTotals.sent}, ` +
      `ошибок: ${totals.failed + managerTotals.failed + detailedTotals.failed}`
  );

  return finish({
    trigger,
    requestedBy,
    startedAt,
    window,
    requiredDays,
    status: 'ok',
    message: summarize(targets, totals, managerTotals, detailedTotals, unreported.length),
    rows,
    totals,
    managerRows,
    managerTotals,
    detailedRows,
    detailedTotals,
    vacations: vacations.report,
  }, schedule);
}

/**
 * Отпуска из корпоративного календаря — по одному запросу на прогон.
 *
 * Ошибка календаря не останавливает рассылку: остаться без напоминаний из-за
 * недоступности Google хуже, чем один раз дёрнуть отпускника. Но и молчать о ней
 * нельзя — иначе «отпусков нет» не отличить от «календарь не прочитался», поэтому
 * причина уезжает в отчёт и в лог.
 *
 * @returns {Promise<{daysByPerson: Map<string, Set<string>>, report: object}>}
 */
async function loadVacations({ settings, users, icsUrl, range }) {
  const empty = new Map();
  if (!settings.skipVacations) {
    return { daysByPerson: empty, report: { enabled: false, used: false, warning: null } };
  }
  if (!icsUrl) {
    return {
      daysByPerson: empty,
      report: {
        enabled: true,
        used: false,
        warning:
          'The vacation calendar is on, but its iCal address is not set — vacations were ignored',
      },
    };
  }

  try {
    const result = await getVacationDays({ icsUrl, people: users, range });
    const peopleOnLeave = result.daysByPerson.size;
    console.log(
      `Календарь отпусков: событий ${result.totalEvents}, сматчилось ${result.matchedEvents}, ` +
        `людей с отпуском в окне ${peopleOnLeave}, не сматчилось заголовков ${result.unmatched.length}`
    );
    return {
      daysByPerson: result.daysByPerson,
      report: {
        enabled: true,
        used: true,
        warning:
          result.recurringSkipped > 0
            ? `${result.recurringSkipped} repeating calendar events were ignored — the app doesn’t expand recurring events`
            : null,
        matchedEvents: result.matchedEvents,
        unmatchedTitles: result.unmatched.length,
        peopleOnLeave,
      },
    };
  } catch (e) {
    console.error(`Календарь отпусков не прочитан: ${e.message}`);
    return {
      daysByPerson: empty,
      report: {
        enabled: true,
        used: false,
        warning: `Couldn’t read the vacation calendar: ${e.message} — vacations were ignored`,
      },
    };
  }
}

/**
 * Напоминания самим сотрудникам: по одному DM каждому, у кого хотя бы за один
 * спрашиваемый день нет записей в Tempo.
 */
async function remindUsers({
  users,
  missingDaysByUser,
  excusedDaysByUser,
  vacationDaysByPerson,
  today,
  requiredDays,
  window,
  settings,
  slackBotToken,
  progress,
}) {
  const rows = [];
  const slackIdsToCache = {};

  await progress(RUN_PHASE.users, { done: 0, total: users.length, force: true });
  for (const user of users) {
    await progress(RUN_PHASE.users, { done: rows.length, total: users.length });
    const missingDays = missingDaysByUser.get(user.accountId) ?? [];
    const excusedDays = excusedDaysByUser.get(user.accountId) ?? [];
    if (missingDays.length === 0) {
      // Отпуск закрыл ровно те дни, за которые записей нет: человек ничего не
      // должен, и в отчёте это отдельный исход — иначе выглядело бы так, будто
      // время залогировано.
      rows.push(
        excusedDays.length > 0
          ? row(user, OUTCOME.onLeave, `On leave for the days with no entries: ${formatDays(excusedDays)}`)
          : row(user, OUTCOME.logged, `Has entries for all ${requiredDays.length} checked days`)
      );
      continue;
    }

    // Человек в отпуске сегодня, но за более старые дни окна долг есть. Напомним,
    // когда выйдет: писать в отпуск бессмысленно. Менеджеру он в дайджест попадёт.
    if (settings.skipDmWhileOnLeave && vacationDaysByPerson.get(user.accountId)?.has(today)) {
      rows.push(
        row(
          user,
          OUTCOME.onLeave,
          `On leave today — the reminder was held back, missing: ${formatDays(missingDays)}`
        )
      );
      continue;
    }

    const text = renderUserMessage(settings.messageTemplate, {
      user,
      missingDays,
      window,
      lookbackWorkingDays: settings.lookbackWorkingDays,
    });
    const sent = await dm(user, text, slackBotToken, slackIdsToCache);
    const detail =
      sent.outcome === OUTCOME.reminded
        ? `Reminder sent, no entries for: ${formatDays(missingDays)}`
        : sent.detail;
    rows.push(row(user, sent.outcome, detail));
  }

  await cacheSlackUserIds(slackIdsToCache);
  return rows;
}

/**
 * Сообщения менеджерам: одно каждому из списка. Тем, у кого кто-то не отчитался,
 * уходит дайджест со списком таких подчинённых; остальным — отдельный текст о том,
 * что отчитались все. Молчание в этом случае неотличимо от сломавшейся рассылки,
 * поэтому пишем всем.
 */
async function notifyManagers({
  users,
  unreported,
  missingDaysByUser,
  window,
  settings,
  slackBotToken,
  progress,
}) {
  const managers = await getManagers();
  if (managers.length === 0) return [];

  const withPeople = new Map(
    groupByManager(unreported, managers).map(({ manager, people }) => [manager.accountId, people])
  );
  const managedCounts = countManagedPeople(users);
  const rows = [];
  const slackIdsToCache = {};

  await progress(RUN_PHASE.managers, { done: 0, total: managers.length, force: true });
  for (const manager of managers) {
    await progress(RUN_PHASE.managers, { done: rows.length, total: managers.length });
    const people = withPeople.get(manager.accountId) ?? [];
    const isAllClear = people.length === 0;
    const managedCount = managedCounts.get(manager.accountId) ?? 0;

    const text = isAllClear
      ? renderManagerAllClearMessage(settings.managerAllClearTemplate, {
          manager,
          managedCount,
          window,
          lookbackWorkingDays: settings.lookbackWorkingDays,
        })
      : renderManagerMessage(settings.managerMessageTemplate, {
          manager,
          people,
          missingDaysByUser,
          window,
          lookbackWorkingDays: settings.lookbackWorkingDays,
        });

    const sent = await dm(manager, text, slackBotToken, slackIdsToCache);
    const delivered = sent.outcome === OUTCOME.reminded;
    const outcome = delivered ? (isAllClear ? OUTCOME.allClear : OUTCOME.notified) : sent.outcome;
    const detail = delivered ? describeSent(people, managedCount) : sent.detail;
    rows.push(managerRow(manager, people.length, outcome, detail));
  }

  await cacheManagerSlackUserIds(slackIdsToCache);
  return rows;
}

/**
 * Детальные отчёты: по одному сообщению на пару «сотрудник — его менеджер».
 *
 * Здесь не проверка, а разбор: за каждый день окна в сообщение уходит список задач
 * с типом работы и описанием. Окно берётся целиком, без скидки на acceptable delay —
 * менеджер, который смотрит человека глубоко, хочет видеть и сегодняшний день.
 *
 * Одно сообщение — один сотрудник: сшивать нескольких в письмо значило бы отправить
 * менеджеру простыню, в которой ничего не найти.
 */
async function sendDetailedReports({
  detailedUsers,
  vacationDaysByPerson,
  window,
  settings,
  isHoliday,
  tempoToken,
  slackBotToken,
  progress,
}) {
  if (detailedUsers.length === 0) return [];

  const managersById = new Map((await getManagers()).map((manager) => [manager.accountId, manager]));
  const rows = [];
  const slackIdsToCache = {};
  // Разные люди списывают время в одни и те же задачи — ключи добираем один раз на прогон.
  const issueCache = new Map();
  // Строк здесь больше, чем людей: у одного сотрудника может быть несколько
  // получателей, и каждая доставка — своя строка. Считаем поэтому людей.
  let done = 0;

  await progress(RUN_PHASE.detailed, { done: 0, total: detailedUsers.length, force: true });
  for (const user of detailedUsers) {
    await progress(RUN_PHASE.detailed, { done, total: detailedUsers.length });
    done += 1;
    const recipients = (user.detailedManagerIds ?? [])
      .map((accountId) => managersById.get(accountId))
      .filter(Boolean);
    // В список детальных человек попадает как раз по непустому набору получателей,
    // так что сюда можно приехать только со ссылкой на менеджера, удалённого между
    // чтением списков. Молчать об этом всё равно нельзя.
    if (recipients.length === 0) {
      rows.push(
        detailedRow(
          user,
          null,
          OUTCOME.noManager,
          'Nobody is assigned to receive this report — fill in the “Managers who get the detailed report” column'
        )
      );
      continue;
    }

    let entries;
    try {
      entries = await getUserWorklogs(user.accountId, window.from, window.to, tempoToken);
      await resolveIssues(entries, issueCache);
      await sleep(TEMPO_USER_PAUSE_MS);
    } catch (e) {
      console.error(`Детальный отчёт по ${user.accountId} не собран: ${e.message}`);
      rows.push(detailedRow(user, null, OUTCOME.error, `Couldn’t read the worklogs: ${e.message}`));
      continue;
    }

    const days = buildDailyReport({
      window,
      worklogs: entries,
      isHoliday,
      vacationDays: vacationDaysByPerson.get(user.accountId) ?? null,
    });
    const report = formatDailyReport(days);
    const daysWithEntries = days.filter((day) => day.entries.length > 0).length;

    for (const manager of recipients) {
      const text = renderDetailedReportMessage(settings.detailedReportTemplate, {
        manager,
        user,
        report,
        window,
        lookbackWorkingDays: settings.lookbackWorkingDays,
      });
      const sent = await dm(manager, text, slackBotToken, slackIdsToCache);
      rows.push(
        detailedRow(
          user,
          manager,
          sent.outcome === OUTCOME.reminded ? OUTCOME.reported : sent.outcome,
          sent.outcome === OUTCOME.reminded
            ? `Report sent: ${entries.length} entries on ${daysWithEntries} of ${days.length} days`
            : sent.detail
        )
      );
    }
  }

  // Получатели здесь — менеджеры, их найденные Slack-id кэшируются в своём списке.
  await cacheManagerSlackUserIds(slackIdsToCache);
  return rows;
}

/**
 * Проставляет записям ключ задачи и её заголовок: Tempo знает только числовой id.
 *
 * Недобранная задача отчёт не ломает — в сообщении вместо ключа останется id,
 * поэтому getIssues не бросает исключений, а логирует и отдаёт что нашлось.
 */
async function resolveIssues(entries, cache) {
  const unknown = [
    ...new Set(
      entries
        .filter((entry) => !entry.issueKey && entry.issueId !== null)
        .map((entry) => String(entry.issueId))
        .filter((id) => !cache.has(id))
    ),
  ];
  if (unknown.length > 0) {
    const found = await getIssues(unknown);
    for (const id of unknown) cache.set(id, found.get(id) ?? null);
  }

  for (const entry of entries) {
    const issue = entry.issueId === null ? null : cache.get(String(entry.issueId));
    entry.issueKey = entry.issueKey ?? issue?.key ?? null;
    entry.issueSummary = issue?.summary ?? null;
  }
}

/**
 * Что именно ушло менеджеру — строкой для отчёта. Менеджер без единого закреплённого
 * сотрудника тоже получает «всё в порядке», и это стоит отметить: скорее всего его
 * просто забыли проставить кому-то в колонке Managers.
 */
function describeSent(people, managedCount) {
  if (people.length > 0) return `Digest sent about: ${people.map((p) => p.displayName).join(', ')}`;
  return managedCount > 0
    ? `All clear message sent: all ${managedCount} of their people have logged time`
    : 'All clear message sent, but nobody is assigned to this manager';
}

/**
 * Отправка одного DM: поиск человека в Slack по email (с кэшированием id) и сообщение.
 * Ошибка на одном получателе не роняет прогон — она превращается в строку отчёта.
 */
async function dm(person, text, slackBotToken, slackIdsToCache) {
  if (!person.email) {
    return {
      outcome: OUTCOME.noEmail,
      detail: 'No email — the Slack user can’t be found. Set the email manually in the settings',
    };
  }

  try {
    let slackUserId = person.slackUserId;
    if (!slackUserId) {
      slackUserId = await lookupSlackUserByEmail(person.email, slackBotToken);
      await sleep(SLACK_LOOKUP_PAUSE_MS);
      if (!slackUserId) {
        return { outcome: OUTCOME.noSlack, detail: `No Slack user with email ${person.email}` };
      }
      slackIdsToCache[person.accountId] = slackUserId;
    }

    await sendSlackDm(slackUserId, text, slackBotToken);
    await sleep(SLACK_SEND_PAUSE_MS);
    return { outcome: OUTCOME.reminded, detail: 'Reminder sent' };
  } catch (e) {
    console.error(`Ошибка для ${person.accountId}: ${e.message}`);
    return { outcome: OUTCOME.error, detail: e.message };
  }
}

/**
 * Пора ли запускать плановую проверку прямо сейчас — отдельно для каждой рассылки.
 *
 * Триггер будит функцию раз в час, а расписания задаются списками времён в настройках,
 * значит решение принимается здесь. Слот считается наступившим, если его время уже
 * прошло (но не больше чем на CATCH_UP_MINUTES) и он ещё не отработал в текущих сутках.
 *
 * Наступивших слотов может оказаться несколько — если триггер пропустил час. Прогон
 * при этом один, а закрываются все: два одинаковых сообщения подряд человеку не нужны.
 */
export async function evaluateSchedule(settings, now = new Date(), isHoliday = () => null) {
  const { date, minutes } = dayParts(now);
  const empty = { [RUN_KIND.users]: [], [RUN_KIND.managers]: [] };

  if (settings.runTimes.length === 0 && settings.managerRunTimes.length === 0) {
    return { shouldRun: false, date, due: empty, reason: 'No run times are configured — scheduled checks are off' };
  }
  const holiday = isHoliday(date);
  if (holiday) {
    return {
      shouldRun: false,
      date,
      due: empty,
      reason: `${holiday.name} — the scheduled run was skipped`,
    };
  }
  if (settings.skipWeekends && isWeekend(date)) {
    return { shouldRun: false, date, due: empty, reason: 'Weekend — the scheduled run was skipped' };
  }

  const due = {
    [RUN_KIND.users]: await dueFor(settings.runTimes, RUN_KIND.users, date, minutes),
    [RUN_KIND.managers]: await dueFor(settings.managerRunTimes, RUN_KIND.managers, date, minutes),
  };
  if (due[RUN_KIND.users].length === 0 && due[RUN_KIND.managers].length === 0) {
    return {
      shouldRun: false,
      date,
      due,
      reason: `It’s ${formatClock(minutes)} ${SCHEDULE_TIME_ZONE} — no run time is due, the scheduled run was skipped`,
    };
  }

  return { shouldRun: true, date, due, reason: null };
}

async function dueFor(runTimes, kind, date, nowMinutes) {
  if (runTimes.length === 0) return [];
  return dueRunTimes({
    runTimes,
    nowMinutes,
    handledTimes: await getHandledRunTimes(date, kind),
    catchUpMinutes: CATCH_UP_MINUTES,
  });
}

/**
 * Для страницы настроек: текущее время и ближайший запуск каждой из рассылок.
 */
export async function describeSchedule(settings, now = new Date()) {
  const { date, minutes } = dayParts(now);
  const isHoliday = settings.skipHolidays ? makeHolidayChecker(await getHolidays()) : () => null;
  const isSkippedDay = (day) =>
    (settings.skipWeekends && isWeekend(day)) || Boolean(isHoliday(day));

  const next = async (runTimes, kind) =>
    nextRunTime({
      runTimes,
      isSkippedDay,
      today: date,
      nowMinutes: minutes,
      handledTimes: await getHandledRunTimes(date, kind),
    });

  const [users, managers] = await Promise.all([
    next(settings.runTimes, RUN_KIND.users),
    next(settings.managerRunTimes, RUN_KIND.managers),
  ]);

  return {
    timeZone: SCHEDULE_TIME_ZONE,
    now: `${date} ${formatClock(minutes)}`,
    nextRun: users ? `${users.date} ${users.time}` : null,
    nextManagerRun: managers ? `${managers.date} ${managers.time}` : null,
    catchUpMinutes: CATCH_UP_MINUTES,
  };
}

/** Наступившие слоты одной строкой — для логов планового запуска. */
export function describeDue(due) {
  return (
    [
      due[RUN_KIND.users].length > 0 && `сотрудники ${due[RUN_KIND.users].join(', ')}`,
      due[RUN_KIND.managers].length > 0 && `менеджеры ${due[RUN_KIND.managers].join(', ')}`,
    ]
      .filter(Boolean)
      .join('; ') || '—'
  );
}

// Строку отчёта хранит KVS с лимитом на размер значения, поэтому длинный перечень
// дней в ней сокращается; полный список человек видит в самом сообщении.
const MAX_DAYS_IN_DETAIL = 5;

function formatDays(days) {
  if (days.length <= MAX_DAYS_IN_DETAIL) return days.join(', ');
  const shown = days.slice(0, MAX_DAYS_IN_DETAIL).join(', ');
  return `${shown} and ${days.length - MAX_DAYS_IN_DETAIL} more`;
}

function row(user, outcome, detail) {
  return {
    accountId: user.accountId,
    displayName: user.displayName,
    email: user.email ?? null,
    outcome,
    detail,
  };
}

function managerRow(manager, reportedCount, outcome, detail) {
  return { ...row(manager, outcome, detail), reportedCount };
}

/**
 * Строка детального отчёта — про пару «сотрудник и его менеджер»: сообщение уходит
 * каждому получателю отдельно, и доставка у них тоже своя. Поэтому отдельный ключ:
 * accountId сотрудника в такой таблице повторяется.
 */
function detailedRow(user, manager, outcome, detail) {
  return {
    key: manager ? `${user.accountId}:${manager.accountId}` : user.accountId,
    accountId: user.accountId,
    displayName: user.displayName,
    managerName: manager?.displayName ?? null,
    outcome,
    detail,
  };
}

function countUserOutcomes(rows) {
  const totals = { tracked: rows.length, logged: 0, reminded: 0, onLeave: 0, skipped: 0, failed: 0 };
  for (const { outcome } of rows) {
    if (outcome === OUTCOME.logged) totals.logged++;
    else if (outcome === OUTCOME.reminded) totals.reminded++;
    else if (outcome === OUTCOME.onLeave) totals.onLeave++;
    else if (outcome === OUTCOME.error) totals.failed++;
    else totals.skipped++;
  }
  return totals;
}

function countManagerOutcomes(rows, unreported) {
  const totals = {
    managers: rows.length,
    notified: 0,
    allClear: 0,
    failed: 0,
    skipped: 0,
    // Не отчитавшиеся, которым не назначен ни один менеджер: о них не узнает никто,
    // и это стоит видеть в отчёте, а не выяснять по факту тишины.
    withoutManager: countWithoutManager(unreported),
  };
  for (const { outcome } of rows) {
    if (outcome === OUTCOME.notified) totals.notified++;
    else if (outcome === OUTCOME.allClear) totals.allClear++;
    else if (outcome === OUTCOME.error) totals.failed++;
    else totals.skipped++;
  }
  return totals;
}

function countDetailedOutcomes(rows, peopleCount) {
  const totals = { people: peopleCount, sent: 0, failed: 0, skipped: 0, withoutManager: 0 };
  for (const { outcome } of rows) {
    if (outcome === OUTCOME.reported) totals.sent++;
    else if (outcome === OUTCOME.error) totals.failed++;
    // Человек в списке, но получателя у отчёта нет — молча это терять нельзя.
    else if (outcome === OUTCOME.noManager) totals.withoutManager++;
    else totals.skipped++;
  }
  return totals;
}

function summarize(targets, totals, managerTotals, detailedTotals, unreportedCount) {
  const parts = [`${unreportedCount} of the tracked people are missing at least one checked day`];
  if (targets.users) parts.push(`reminders sent: ${totals.reminded}`);
  if (targets.users && totals.onLeave > 0) parts.push(`on leave: ${totals.onLeave}`);
  if (targets.managers) {
    parts.push(
      `manager digests sent: ${managerTotals.notified}, all-clear notes: ${managerTotals.allClear}`
    );
  }
  if (targets.detailed && detailedTotals.people > 0) {
    parts.push(`detailed reports sent: ${detailedTotals.sent}`);
  }
  if (!targets.users && !targets.managers && !targets.detailed) parts.push('nothing was sent');
  return parts.join(', ');
}

async function finish(report, schedule = null) {
  const full = {
    rows: [],
    totals: { tracked: 0, logged: 0, reminded: 0, onLeave: 0, skipped: 0, failed: 0 },
    managerRows: [],
    managerTotals: { managers: 0, notified: 0, allClear: 0, failed: 0, skipped: 0, withoutManager: 0 },
    detailedRows: [],
    detailedTotals: { people: 0, sent: 0, failed: 0, skipped: 0, withoutManager: 0 },
    // Что вышло с календарём отпусков: включён ли он, прочитался ли и что мешало.
    vacations: { enabled: false, used: false, warning: null },
    window: null,
    // Дни, за которые время уже обязано быть залогировано — окно минус допустимая задержка.
    requiredDays: [],
    ...report,
    finishedAt: new Date().toISOString(),
  };
  const saved = await saveLastReport(full);

  // Слоты закрываются только после успеха: если Tempo или Slack не ответили,
  // слот остаётся наступившим и следующее часовое срабатывание повторит попытку
  // — но лишь пока не вышло окно CATCH_UP_MINUTES.
  if (full.status === 'ok' && schedule) {
    for (const kind of Object.values(RUN_KIND)) {
      if (schedule.due[kind].length > 0) await markRunTimesHandled(schedule.date, kind, schedule.due[kind]);
    }
  }

  await setRunStatus({ state: 'idle', lastTrigger: full.trigger, lastStatus: full.status });
  if (full.status !== 'ok') console.log(`Прогон завершён со статусом ${full.status}: ${full.message}`);
  return saved;
}
