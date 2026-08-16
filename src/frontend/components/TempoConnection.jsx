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

// Пока администратор ходит по вкладке Tempo, подключение приезжает не в ответ на
// действие в UI, а через веб-триггер — заметить его можно только опросом.
const POLL_INTERVAL_MS = 2500;
// Дольше ждать нечего: ссылка живёт десять минут, но вкладку к этому времени
// обычно уже закрыли и забыли. Ожидание снимается, кнопка возвращается.
const WAIT_LIMIT_MS = 3 * 60 * 1000;

/**
 * Подключение Tempo.
 *
 * Кнопка ведёт на экран согласия Tempo в соседней вкладке; вернувшись оттуда,
 * приложение само кладёт токен в секретное хранилище и дальше продлевает его
 * само. Другого пути подключения в UI нет — как и у Slack: поле для токена из
 * «Tempo → Settings → API integration» убрано, чтобы не предлагать рядом с одной
 * кнопкой путь, который к тому же нужно проходить заново каждые 30 дней. Токен,
 * вставленный руками в прежних версиях, продолжает работать — такое подключение
 * здесь подписано как «вставлен руками» и заменяется нажатием «Connect Tempo».
 *
 * @param tempo
 * @param credentials
 * @param {{ok: boolean, message: string}|null} testResult итог общей проверки на вкладке
 * @param {(result: object) => void} onResult результат резолвера {credentials, slack, tempo}
 * @param {(message: object|null) => void} onMessage сообщение о результате действия
 */
export const TempoConnection = ({ tempo, credentials, testResult, onResult, onMessage }) => {
  const connection = tempo?.connection ?? null;
  const status = credentials?.tempoToken ?? { isSet: false };
  const oauthAvailable = Boolean(tempo?.oauthAvailable);

  const [busy, setBusy] = useState(null);
  const [isWaiting, setWaiting] = useState(false);
  const [isConfirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Каким было подключение в момент нажатия кнопки: по смене этой отметки видно,
  // что колбэк доехал. Сравнивать по «токен задан» нельзя — повторное подключение
  // поверх уже работающего так не заметить.
  const connectedAtOnStart = useRef(null);

  const isConnected = status.isSet && Boolean(connection);
  const isBroken = Boolean(connection?.brokenError);
  const isOAuth = connection?.method === 'oauth';

  useEffect(() => {
    if (!isWaiting) return undefined;

    const check = async () => {
      try {
        const result = await api.getTempoStatus();
        const next = result.tempo?.connection ?? null;
        if (!next?.connectedAt || next.connectedAt === connectedAtOnStart.current) return;
        setWaiting(false);
        onResult(result);
        onMessage({ appearance: 'success', text: 'Tempo is connected' });
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
        text: 'Still nothing from Tempo. Finish the authorization in the Tempo tab, or press “Connect Tempo” to start again.',
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
      const { url } = await api.startTempoConnect();
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
      const result = await api.disconnectTempo();
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
        <Heading as="h4" size="small">Tempo</Heading>
        {isConnected && !isBroken && (
          <Lozenge appearance="success">{isOAuth ? 'connected' : 'connected · pasted token'}</Lozenge>
        )}
        {isConnected && isBroken && <Lozenge appearance="removed">rejected by Tempo</Lozenge>}
        {!isConnected && <Lozenge appearance="removed">not connected</Lozenge>}
      </Inline>

      {isConnected && isOAuth && (
        <Text>
          Worklogs are read with the permissions of whoever authorized Tempo
          {connection.connectedAt ? `, connected ${formatInstant(connection.connectedAt)}` : ''}. The
          app renews the access on its own
          {connection.expiresAt ? `; the current one is valid until ${formatInstant(connection.expiresAt)}` : ''}.
        </Text>
      )}

      {isConnected && !isOAuth && oauthAvailable && (
        <Text>
          An API token was pasted by hand. It keeps working, but Tempo expires those on their own
          schedule — press “Connect Tempo” to switch to a connection the app renews itself.
        </Text>
      )}

      {isBroken && (
        <SectionMessage appearance="warning" title="Tempo no longer accepts this connection">
          <Stack space="space.050">
            <Text>
              The last call got “{connection.brokenError}” — usually the access was revoked in Tempo,
              or the person who authorized it lost the permission to view other people’s worklogs.
              No worklogs are being read, so nobody is checked.
            </Text>
            <Text>Connect again to fix it.</Text>
          </Stack>
        </SectionMessage>
      )}

      {/* Итог проверки живёт здесь, а не у кнопки на вкладке: он про эту систему,
          и читается вместе с её лозенгом и сроком токена. */}
      {testResult && (
        <SectionMessage appearance={testResult.ok ? 'success' : 'error'}>
          <Text>{testResult.message}</Text>
        </SectionMessage>
      )}

      {isWaiting && (
        <SectionMessage appearance="information" title="Waiting for Tempo">
          <Inline space="space.100" alignBlock="center">
            <Spinner size="small" />
            <Text>
              Finish the authorization in the Tempo tab that just opened — press Authorize. This page
              picks it up on its own.
            </Text>
          </Inline>
        </SectionMessage>
      )}

      {oauthAvailable ? (
        <Stack space="space.100">
          <Inline space="space.100" alignBlock="center">
            <LoadingButton
              appearance={isConnected && !isBroken ? 'default' : 'primary'}
              isLoading={busy === 'connect'}
              isDisabled={isWaiting}
              onClick={connect}
            >
              {isConnected ? 'Reconnect Tempo' : 'Connect Tempo'}
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
            Tempo grants access with your own permissions, so authorize as somebody who may view
            everybody’s worklogs — otherwise people whose time you can’t see look like they never
            logged any.
          </HelperMessage>
        </Stack>
      ) : (
        // Другого пути в UI нет, поэтому молчать здесь нельзя: без кнопки вкладка
        // выглядела бы так, будто Tempo подключать нечем в принципе.
        <SectionMessage appearance="warning" title="Tempo can’t be connected in this build">
          <Text>
            The Tempo OAuth credentials (TEMPO_CLIENT_ID, TEMPO_CLIENT_SECRET) are not set for this
            deployment, so there is nothing to connect to. Register an OAuth 2.0 application in
            Tempo → Settings → Data Access, set the variables with “forge variables set” and deploy
            again — see the README.
          </Text>
        </SectionMessage>
      )}

      <ConfirmDialog
        isOpen={isConfirmingDisconnect}
        title="Disconnect Tempo?"
        confirmLabel="Disconnect"
        isBusy={busy === 'disconnect'}
        onConfirm={disconnect}
        onCancel={() => setConfirmingDisconnect(false)}
      >
        <Stack space="space.100">
          <Text>
            The access is revoked in Tempo and deleted from Forge secret storage. The app stays
            installed in Jira, but stops reading worklogs — so nobody gets checked.
          </Text>
          <Text>Connecting again takes one click and does not need anything from Tempo settings.</Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
};
