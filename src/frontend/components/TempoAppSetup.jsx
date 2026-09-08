import React, { useEffect, useState } from 'react';
import {
  Button,
  Code,
  HelperMessage,
  Inline,
  Label,
  Link,
  List,
  ListItem,
  LoadingButton,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Разовая настройка: OAuth-приложение Tempo для этой установки.
 *
 * Почему это вообще приходится делать руками. OAuth-приложение Tempo
 * принадлежит инстансу, в котором его завели: его client id существует только в
 * Tempo этого сайта, и приложение, зарегистрированное вендором у себя, чужой
 * установке отвечает «Invalid client id». Одного приложения на всех клиентов не
 * бывает — значит, каждый заводит своё, а API, которым можно было бы завести его
 * за администратора, у Tempo нет.
 *
 * Что тогда остаётся автоматизировать — всё вокруг: прямая ссылка в настройки
 * Tempo вместо блужданий по меню, готовый адрес возврата вместо `forge
 * webtrigger`, и проверка вставленного сразу, а не на первом ночном прогоне.
 * Дальше — одна кнопка «Connect Tempo», и доступ продлевается сам; в Tempo
 * больше не возвращаются.
 *
 * @param tempo состояние подключения; интересует clientSource
 * @param {(result: object) => void} onResult новое состояние доступов
 * @param {(message: object|null) => void} onMessage сообщение о результате действия
 */
export const TempoAppSetup = ({ tempo, onResult, onMessage }) => {
  const source = tempo?.clientSource ?? null;
  // Приложение вендора (переменные сборки) отсюда не меняется: оно общее на все
  // установки, и правит его тот, кто эту сборку деплоит.
  const isOwn = source === 'installation';

  // Не задано — мастер открыт сразу: это единственное, что мешает подключиться.
  const [isOpen, setOpen] = useState(!source);
  const [setup, setSetup] = useState(null);
  const [setupError, setSetupError] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(null);
  const [isConfirmingForget, setConfirmingForget] = useState(false);

  // Адрес возврата и ссылку в Tempo спрашиваем только когда мастер открыт: обе
  // стоят похода в платформу и в Jira, а открывают этот экран один раз за жизнь
  // установки.
  useEffect(() => {
    if (!isOpen || setup) return undefined;

    let cancelled = false;
    api
      .getTempoSetup()
      .then((result) => {
        if (!cancelled) setSetup(result);
      })
      .catch((e) => {
        if (!cancelled) setSetupError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, setup]);

  const save = async () => {
    setBusy('save');
    onMessage(null);
    try {
      const result = await api.saveTempoOAuthApp(clientId, clientSecret);
      onResult(result);
      setClientId('');
      setClientSecret('');
      setOpen(false);
      onMessage({
        appearance: 'success',
        text: 'The Tempo application is saved — press “Connect Tempo” to authorize it',
      });
    } catch (e) {
      onMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    setBusy('forget');
    onMessage(null);
    try {
      const result = await api.clearTempoOAuthApp();
      onResult(result);
      setOpen(true);
      onMessage({ appearance: 'information', text: 'The Tempo application credentials were removed' });
    } catch (e) {
      onMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
      setConfirmingForget(false);
    }
  };

  // Закрытый вид: приложение уже задано, и место на вкладке принадлежит не ему,
  // а подключению. Одна строка и две неброские кнопки.
  if (!isOpen) {
    return (
      <Stack space="space.050">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Text>
            {isOwn
              ? 'OAuth application: registered in this site’s Tempo.'
              : 'OAuth application: the one this build ships with.'}
          </Text>
          {/* Своё приложение заводится и поверх вендорского: то принадлежит
              инстансу вендора и чужой Jira может не подойти вовсе — оставлять
              такую установку без выхода нельзя. */}
          <Button appearance="subtle" spacing="compact" onClick={() => setOpen(true)}>
            {isOwn ? 'Replace' : 'Use this site’s own application'}
          </Button>
          {isOwn && (
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => setConfirmingForget(true)}
            >
              Forget
            </Button>
          )}
        </Inline>

        <ConfirmDialog
          isOpen={isConfirmingForget}
          title="Forget the Tempo application?"
          confirmLabel="Forget"
          isBusy={busy === 'forget'}
          onConfirm={forget}
          onCancel={() => setConfirmingForget(false)}
        >
          <Stack space="space.100">
            <Text>
              The client ID and secret are deleted from Forge secret storage. The access already
              granted keeps working until it expires, but the app can no longer renew it — and
              connecting again needs an application here.
            </Text>
            <Text>The application itself stays in Tempo; delete it there if you don’t need it.</Text>
          </Stack>
        </ConfirmDialog>
      </Stack>
    );
  }

  return (
    <Stack space="space.150">
      <SectionMessage
        appearance="information"
        title={isOwn ? 'Replace the Tempo OAuth application' : 'One-time setup: a Tempo OAuth application'}
      >
        <Stack space="space.100">
          <Text>
            A Tempo OAuth application belongs to the Jira site it was created in, so this site needs
            one of its own — an application registered anywhere else answers “Invalid client id”.
            It takes a minute, and it is the last time anybody opens Tempo settings: after this the
            app renews its access itself.
          </Text>
          {setupError && <Text>Could not work out what to put into Tempo: {setupError}</Text>}
          {!setup && !setupError && (
            <Inline space="space.100" alignBlock="center">
              <Spinner size="small" />
              <Text>Working out the redirect URI…</Text>
            </Inline>
          )}
          {setup && (
            <List type="ordered">
              <ListItem>
                {/* Ссылка ведёт прямо на вкладку с OAuth-приложениями, но раздел
                    назван и словами: если Tempo переставит свои страницы, шаг
                    останется выполнимым. */}
                <Text>
                  Open{' '}
                  <Link href={setup.tempoOAuthAppsUrl} openNewTab>
                    Tempo → Settings → Data Access → OAuth 2.0 Applications
                  </Link>{' '}
                  and press "New Application".
                </Text>
              </ListItem>
              <ListItem>
                <Text>Fill in:</Text>
                {/* Вложенный уровень — это List внутри ListItem, а не ListItem
                    внутри ListItem: маркеры и отступ рисует List, поэтому без
                    него вложенные пункты встают в один столбец с родителем. */}
                <List type="unordered">
                  <ListItem>
                    <Text>
                      Name: <Code>Tempo Reminders</Code>
                    </Text>
                  </ListItem>
                  <ListItem>
                    <Text>
                      Redirect URIs: <Code>{setup.redirectUri}</Code>
                    </Text>
                  </ListItem>
                  <ListItem>
                    <Text>
                      Client Type: <Code>Public</Code>
                    </Text>
                  </ListItem>
                  <ListItem>
                    <Text>
                      Authorization grant type: <Code>Authorization code</Code>
                    </Text>
                  </ListItem>
                </List>
              </ListItem>
              <ListItem>
                <Text>Press "Create Application", then paste what Tempo shows into the two fields below.</Text>
              </ListItem>
            </List>
          )}
        </Stack>
      </SectionMessage>

      <Stack space="space.050">
        <Label labelFor="tempo-client-id">Client ID</Label>
        <Textfield
          id="tempo-client-id"
          value={clientId}
          placeholder="the client ID Tempo generated"
          onChange={(e) => setClientId(e.target.value)}
        />
      </Stack>

      <Stack space="space.050">
        <Label labelFor="tempo-client-secret">Client secret</Label>
        {/* type=password — секрет виден в чужой Jira через плечо не реже, чем
            любой другой пароль, а перепечатывать его отсюда не нужно: он уезжает
            в секретное хранилище и обратно не возвращается. */}
        <Textfield
          id="tempo-client-secret"
          type="password"
          value={clientSecret}
          placeholder="the client secret Tempo generated"
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <HelperMessage>
          Tempo shows the secret once, at creation. Lost it — make a new application.
        </HelperMessage>
      </Stack>

      <Inline space="space.100" alignBlock="center">
        <LoadingButton
          appearance="primary"
          isLoading={busy === 'save'}
          isDisabled={!clientId.trim() || !clientSecret.trim()}
          onClick={save}
        >
          Save application
        </LoadingButton>
        {source && (
          <Button
            appearance="subtle"
            onClick={() => {
              setClientId('');
              setClientSecret('');
              setOpen(false);
              onMessage(null);
            }}
          >
            Cancel
          </Button>
        )}
      </Inline>
    </Stack>
  );
};
