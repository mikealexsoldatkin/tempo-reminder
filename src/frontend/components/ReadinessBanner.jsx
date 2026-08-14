import React from 'react';
import { SectionMessage, Stack, Text } from '@forge/react';

/**
 * Сводка «готово ли приложение работать» — единственное место, где видно сразу всё.
 *
 * Без неё каждая нехватка обнаруживалась на своей вкладке: про незаданный токен
 * говорила только вкладка Run check, про пустое расписание — Check parameters, а
 * администратор, добавивший полсотни человек и ушедший, узнавал о неработающей
 * рассылке по её отсутствию. Баннер стоит над вкладками, поэтому виден с любой.
 *
 * Различаем два уровня: blocker — без этого не уйдёт ни одно сообщение, warning —
 * приложение работает, но часть задуманного молчит.
 */
export const ReadinessBanner = ({ settings, credentials, trackedUsers, managers }) => {
  const users = trackedUsers ?? [];
  const withDetailed = users.filter((user) => (user.detailedManagerIds ?? []).length > 0).length;
  const withoutManager = users.filter((user) => (user.managerIds ?? []).length === 0).length;

  const blockers = [
    !credentials?.tempoToken?.isSet &&
      'The Tempo API token is not set — worklogs can’t be read. See the “Access tokens” tab.',
    !credentials?.slackBotToken?.isSet &&
      'The Slack bot token is not set — nothing can be delivered. See the “Access tokens” tab.',
    users.length === 0 &&
      'Nobody is tracked yet — add people on the “Users” tab.',
  ].filter(Boolean);

  const warnings = [
    settings?.runTimes?.length === 0 &&
      settings?.managerRunTimes?.length === 0 &&
      'Both schedules are empty — nothing runs automatically. Only the manual run on the “Run check” tab works.',
    users.length > 0 &&
      managers?.length === 0 &&
      'No managers yet — nobody is told when somebody misses time. Mark managers on the “Users” tab.',
    // Про людей без менеджера говорим, только когда менеджеры вообще заведены:
    // иначе это повтор предыдущей строки.
    managers?.length > 0 &&
      withoutManager > 0 &&
      `${withoutManager} of the tracked people have nobody in the basic report column — no digest mentions them.`,
    settings?.skipVacations &&
      !credentials?.vacationIcsUrl?.isSet &&
      'The vacation calendar is on, but its iCal address is not set — vacations are ignored. See the “Vacations” tab.',
    settings?.managerRunTimes?.length === 0 &&
      (managers?.length > 0 || withDetailed > 0) &&
      'The manager schedule is empty — digests and detailed reports never go out on their own.',
  ].filter(Boolean);

  if (blockers.length === 0 && warnings.length === 0) return null;

  const shown = blockers.length > 0 ? blockers : warnings;
  return (
    <SectionMessage
      appearance={blockers.length > 0 ? 'error' : 'warning'}
      title={
        blockers.length > 0
          ? 'The app can’t send anything yet'
          : 'The app works, but part of it is silent'
      }
    >
      <Stack space="space.050">
        {shown.map((issue) => (
          <Text key={issue}>• {issue}</Text>
        ))}
        {blockers.length > 0 && warnings.length > 0 && (
          <Text>• …and {warnings.length} more thing{warnings.length === 1 ? '' : 's'} to check once the above is fixed.</Text>
        )}
      </Stack>
    </SectionMessage>
  );
};
