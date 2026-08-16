import React, { useEffect, useRef, useState } from 'react';
import {
  Heading,
  HelperMessage,
  Inline,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { router } from '@forge/bridge';
import { api } from '../api';
import { formatInstant } from '../formatTime';
import { ConfirmDialog } from './ConfirmDialog';

// Пока администратор ходит по вкладке Slack, подключение приезжает не в ответ на
// действие в UI, а через веб-триггер — заметить его можно только опросом.
const POLL_INTERVAL_MS = 2500;
// Дольше ждать нечего: ссылка на согласие живёт десять минут, но вкладку к этому
// времени обычно уже закрыли и забыли. Ожидание снимается, кнопка возвращается.
const WAIT_LIMIT_MS = 3 * 60 * 1000;

/**
 * Подключение Slack.
 *
 * Кнопка ведёт на экран согласия Slack в соседней вкладке; вернувшись оттуда,
 * приложение само кладёт bot-токен в секретное хранилище — администратору не
 * нужно ни создавать приложение, ни собирать scope, ни копировать `xoxb-…`.
 * Другого пути подключения в UI нет: поле для ручного ввода токена убрано, чтобы
 * не предлагать двадцать шагов рядом с одной кнопкой. Токен, вставленный руками
 * в прежних версиях, продолжает работать — такое подключение здесь описано как
 * «вставлен руками», и заменяется оно тем же нажатием «Connect Slack».
 *
 * @param slack
 * @param credentials
 * @param {(result: object) => void} onResult результат резолвера {credentials, slack}
 * @param {(message: object|null) => void} onMessage сообщение о результате действия
 */
export const SlackConnection = ({ slack, credentials, onResult, onMessage }) => {
  const connection = slack?.connection ?? null;
  const status = credentials?.slackBotToken ?? { isSet: false };
  const oauthAvailable = Boolean(slack?.oauthAvailable);

  const [busy, setBusy] = useState(null);
  const [isWaiting, setWaiting] = useState(false);
  const [isConfirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Каким было подключение в момент нажатия кнопки: по смене этой отметки видно,
  // что колбэк доехал. Сравнивать по «токен задан» нельзя — повторное подключение
  // поверх уже работающего так не заметить.
  const connectedAtOnStart = useRef(null);

  const isConnected = status.isSet && Boolean(connection);
  const isRevoked = Boolean(connection?.revokedError);
  const isOAuth = connection?.method === 'oauth';

  useEffect(() => {
    if (!isWaiting) return undefined;

    const check = async () => {
      try {
        const result = await api.getSlackStatus();
        const next = result.slack?.connection ?? null;
        if (!next?.connectedAt || next.connectedAt === connectedAtOnStart.current) return;
        setWaiting(false);
        onResult(result);
        onMessage({
          appearance: 'success',
          text: next.teamName ? `Connected to ${next.teamName}` : 'Slack is connected',
        });
      } catch (e) {
        setWaiting(false);
        onMessage({ appearance: 'error', text: e.message });
      }
    };

    const poll = setInterval(check, POLL_INTERVAL_MS);
    const giveUp = setTimeout(() => {
      setWaiting(false);
      onMessage({
        appearance: 'warning',
        text: 'Still nothing from Slack. Finish the installation in the Slack tab, or press “Connect Slack” to start again.',
      });
    }, WAIT_LIMIT_MS);

    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [isWaiting, onResult, onMessage]);

  const connect = async () => {
    setBusy('connect');
    onMessage(null);
    try {
      const { url } = await api.startSlackConnect();
      connectedAtOnStart.current = connection?.connectedAt ?? null;
      // Новая вкладка, а не переход: страница настроек должна остаться открытой —
      // в неё приезжает результат.
      await router.open(url);
      setWaiting(true);
    } catch (e) {
      onMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    onMessage(null);
    try {
      const result = await api.disconnectSlack();
      onResult(result);
      onMessage({ appearance: 'information', text: result.revoked.message });
    } catch (e) {
      onMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
      setConfirmingDisconnect(false);
    }
  };

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        <Heading as="h4" size="small">Slack</Heading>
        {isConnected && !isRevoked && (
          <Lozenge appearance="success">
            {connection.teamName ? `connected · ${connection.teamName}` : 'connected'}
          </Lozenge>
        )}
        {isConnected && isRevoked && <Lozenge appearance="removed">rejected by Slack</Lozenge>}
        {!isConnected && <Lozenge appearance="removed">not connected</Lozenge>}
      </Inline>

      {isConnected && (
        <Text>
          {isOAuth
            ? `Messages are sent by the app’s bot in ${connection.teamName ?? 'your workspace'}` +
              `${connection.connectedAt ? `, connected ${formatInstant(connection.connectedAt)}` : ''}.`
            : 'A bot token was pasted by hand. It keeps working — press “Connect Slack” to replace it with the one-click connection.'}
        </Text>
      )}

      {isRevoked && (
        <SectionMessage appearance="warning" title="Slack no longer accepts this connection">
          <Stack space="space.050">
            <Text>
              A run got “{connection.revokedError}” from Slack — usually that means the app was
              removed from the workspace or the token was revoked. Nothing is being delivered.
            </Text>
            <Text>Connect again to fix it.</Text>
          </Stack>
        </SectionMessage>
      )}

      {isWaiting && (
        <SectionMessage appearance="information" title="Waiting for Slack">
          <Inline space="space.100" alignBlock="center">
            <Spinner size="small" />
            <Text>
              Finish the installation in the Slack tab that just opened — pick the workspace and
              press Allow. This page picks it up on its own.
            </Text>
          </Inline>
        </SectionMessage>
      )}

      {oauthAvailable ? (
        <Stack space="space.100">
          <Inline space="space.100" alignBlock="center">
            <LoadingButton
              appearance={isConnected && !isRevoked ? 'default' : 'primary'}
              isLoading={busy === 'connect'}
              isDisabled={isWaiting}
              onClick={connect}
            >
              {isConnected ? 'Reconnect Slack' : 'Connect Slack'}
            </LoadingButton>
            <LoadingButton
              appearance="subtle"
              isLoading={busy === 'disconnect'}
              isDisabled={!status.isSet}
              onClick={() => setConfirmingDisconnect(true)}
            >
              Disconnect
            </LoadingButton>
          </Inline>
          <HelperMessage>
            Slack will ask you to pick a workspace and approve {(slack?.scopes ?? []).join(', ')} —
            enough to find people by email and send them a direct message. You need to be able to
            install apps in that workspace; otherwise ask a Slack admin to do it and use the manual
            token below.
          </HelperMessage>
        </Stack>
      ) : (
        <SectionMessage appearance="warning" title="Slack can’t be connected in this build">
          <Text>
            The Slack app credentials (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI) are
            not set for this deployment, so there is nothing to connect to. Set them with
            “forge variables set” and deploy again.
          </Text>
        </SectionMessage>
      )}

      <ConfirmDialog
        isOpen={isConfirmingDisconnect}
        title="Disconnect Slack?"
        confirmLabel="Disconnect"
        isBusy={busy === 'disconnect'}
        onConfirm={disconnect}
        onCancel={() => setConfirmingDisconnect(false)}
      >
        <Stack space="space.100">
          <Text>
            The token is revoked in Slack and deleted from Forge secret storage. The app stays
            installed in Jira, but stops delivering anything.
          </Text>
          <Text>Connecting again takes one click and does not need anything from Slack settings.</Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
};
