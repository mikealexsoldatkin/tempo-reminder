import React, { useState } from 'react';
import {
  Box,
  Form,
  Heading,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';
import { formatInstant } from '../formatTime';
import { ConfirmDialog } from './ConfirmDialog';
import { useTransientMessage } from './useTransientMessage';

const CREDENTIALS = [
  {
    name: 'tempoToken',
    title: 'Tempo API token',
    hint: 'Tempo → Settings → API integration → New token. Needs read access to worklogs.',
  },
  {
    name: 'slackBotToken',
    title: 'Slack bot token (xoxb-…)',
    hint: 'Scopes: users:read, users:read.email, chat:write, im:write.',
  },
];

/**
 * Токены хранятся в секретном хранилище Forge (kvs.setSecret) и наружу не отдаются:
 * UI видит только «задан / не задан», последние 4 символа и дату обновления.
 */
export const CredentialsTab = ({ credentials, onCredentialsChange }) => {
  const [inputs, setInputs] = useState({ tempoToken: '', slackBotToken: '' });
  const [busy, setBusy] = useState(null);
  // Сообщения об успехе гаснут сами: «Token saved» под формой — это отчёт о
  // нажатии кнопки, а не признак того, что с токеном сейчас всё хорошо. Про
  // текущее состояние говорит лозенг у поля, и он никуда не денется.
  const [message, setMessage] = useTransientMessage();
  const [testResults, setTestResults] = useState(null);
  // Токен из секретного хранилища не читается — «Remove» стирает единственный
  // экземпляр значения, и восстановить его можно только сходив за новым в Tempo
  // или Slack. Поэтому спрашиваем.
  const [pendingClear, setPendingClear] = useState(null);

  const withBusy = async (key, action) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  // Пустое поле «сохранить» не значит ничего: кнопка в этом случае заблокирована,
  // а Enter в пустом поле форму всё же отправляет — его и отсекаем.
  const save = (name) => {
    if (inputs[name].trim().length === 0) return undefined;
    return withBusy(`save:${name}`, async () => {
      const result = await api.saveCredential(name, inputs[name]);
      onCredentialsChange(result.credentials);
      setInputs((prev) => ({ ...prev, [name]: '' }));
      setMessage({ appearance: 'success', text: 'Token saved' });
      setTestResults(null);
    });
  };

  const clear = async (name) => {
    await withBusy(`clear:${name}`, async () => {
      const result = await api.clearCredential(name);
      onCredentialsChange(result.credentials);
      setMessage({ appearance: 'information', text: 'Token removed' });
      setTestResults(null);
    });
    setPendingClear(null);
  };

  const test = () =>
    withBusy('test', async () => {
      setTestResults(await api.testConnections());
    });

  return (
    <Stack space="space.150">
      <Heading as="h3" size="medium">Access tokens</Heading>
      <Text>
        The app uses no environment variables: both Tempo and Slack authenticate with the tokens
        from this form. Values are kept in Forge secret storage and are never returned to the UI.
      </Text>

      {CREDENTIALS.map(({ name, title, hint }) => {
        const status = credentials[name] ?? { isSet: false };
        return (
          <Box key={name}>
            <Stack space="space.100">
              <Inline space="space.100" alignBlock="center">
                <Label labelFor={`credential-${name}`}>{title}</Label>
                {status.isSet ? (
                  <Lozenge appearance="success">set {status.maskedTail}</Lozenge>
                ) : (
                  <Lozenge appearance="removed">not set</Lozenge>
                )}
              </Inline>
              {/* Форма ради Enter: Textfield в UI Kit не принимает onKeyDown, и
                  вставленный в поле токен иначе не сохранить, не целясь в кнопку. */}
              <Form onSubmit={() => save(name)}>
                <Inline space="space.100" alignBlock="end">
                  <Textfield
                    id={`credential-${name}`}
                    type="password"
                    width={340}
                    value={inputs[name]}
                    placeholder={
                      status.isSet ? 'Enter a new value to replace it' : 'Paste the token'
                    }
                    onChange={(e) => setInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                  <LoadingButton
                    appearance="primary"
                    type="submit"
                    isLoading={busy === `save:${name}`}
                    isDisabled={inputs[name].trim().length === 0}
                  >
                    Save
                  </LoadingButton>
                  {/* type="button" обязателен: внутри формы кнопка по умолчанию
                      отправляет её, и «Remove» сохранял бы токен. */}
                  <LoadingButton
                    appearance="subtle"
                    type="button"
                    isLoading={busy === `clear:${name}`}
                    isDisabled={!status.isSet}
                    onClick={() => setPendingClear({ name, title })}
                  >
                    Remove
                  </LoadingButton>
                </Inline>
              </Form>
              <HelperMessage>
                {hint}
                {status.updatedAt ? ` Updated: ${formatInstant(status.updatedAt)}.` : ''}
              </HelperMessage>
            </Stack>
          </Box>
        );
      })}

      <Inline space="space.100">
        <LoadingButton isLoading={busy === 'test'} onClick={test}>
          Test connection
        </LoadingButton>
      </Inline>

      {testResults && (
        <Stack space="space.100">
          <SectionMessage appearance={testResults.tempo.ok ? 'success' : 'error'}>
            <Text>Tempo: {testResults.tempo.message}</Text>
          </SectionMessage>
          <SectionMessage appearance={testResults.slack.ok ? 'success' : 'error'}>
            <Text>Slack: {testResults.slack.message}</Text>
          </SectionMessage>
        </Stack>
      )}

      {message && (
        <SectionMessage appearance={message.appearance}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}

      <ConfirmDialog
        isOpen={pendingClear !== null}
        title="Remove the token?"
        confirmLabel="Remove token"
        isBusy={busy === `clear:${pendingClear?.name}`}
        onConfirm={() => clear(pendingClear.name)}
        onCancel={() => setPendingClear(null)}
      >
        <Stack space="space.100">
          <Text>
            The {pendingClear?.title} will be deleted from Forge secret storage. The app never reads
            it back, so nothing here can restore it — you would have to issue a new one.
          </Text>
          <Text>
            Until then every run fails on that side: no worklogs are read, or nothing is delivered.
          </Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
};
