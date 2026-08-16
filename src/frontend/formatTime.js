/**
 * Время на странице настроек — в одной зоне со всем остальным, что показывает
 * приложение.
 *
 * Расписания, окно проверки, списки дней и «сейчас в UTC» из describeSchedule
 * приходят с бэкенда в UTC. Метки времени (когда стартовал прогон, когда обновляли
 * токен) — это ISO-строки, и `toLocaleString()` рисовал их в зоне браузера. В
 * строке «2026-08-15, 17:03 · window 2026-08-11 — 2026-08-15» соседние числа
 * оказывались из разных часовых поясов, и разница в три часа читалась как
 * расхождение данных, а не как разница зон.
 *
 * Поэтому формат один: `2026-08-15 14:03 UTC` — тот же порядок частей, что у
 * `schedule.now`, плюс явная зона. Зона названа прямо в строке: без подписи
 * «14:03» точно так же неотличимо от местного времени.
 *
 * Значение SCHEDULE_TIME_ZONE продублировано с backend/schedule.js намеренно:
 * фронтенд Forge собирается отдельным бандлом и импортировать бэкендовый модуль
 * (он тянет KVS) не может — та же причина, что у списков месяцев в HolidaysTab.
 */
export const SCHEDULE_TIME_ZONE = 'UTC';

/**
 * ISO-строка → `2026-08-15 14:03 UTC`.
 *
 * @param {string|null|undefined} iso
 * @param {string} [timeZone]
 * @returns {string} «—», если разобрать нечего: пустая метка времени — это
 *   отсутствие события, а не полночь 1970-го.
 */
export const formatInstant = (iso, timeZone = SCHEDULE_TIME_ZONE) => {
  const ts = Date.parse(iso ?? '');
  if (!Number.isFinite(ts)) return '—';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${timeZone}`;
};
