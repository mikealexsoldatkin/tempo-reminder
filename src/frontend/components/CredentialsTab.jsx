import React, { useCallback, useState } from 'react';
import { Heading, Inline, LoadingButton, SectionMessage, Stack, Text } from '@forge/react';
import { api } from '../api';
import { SlackConnection } from './SlackConnection';
import { TokenField } from './TokenField';
import { useTransientMessage } from './useTransientMessage';

/**
 * Доступы к двум внешним системам. Устроены они по-разному, и вкладка это
 * показывает: Slack подключается кнопкой (приложение само получает bot-токен по
 * OAuth), у Tempo подключения по кнопке нет — там администратор выпускает токен
 * в настройках Tempo и вставляет его сюда.
 *
 * Что бы ни было источником, значение уезжает в секретное хранилище Forge
 * (kvs.setSecret) и наружу не возвращается: UI видит только «задан / не задан»,
 * последние 4 символа и дату обновления.
 */
export const CredentialsTab = ({ credentials, slack, onCredentialsChange }) => {
  const [isTesting, setTesting] = useState(false);
  // Сообщения об успехе гаснут сами: «Token saved» под формой — это отчёт о
  // нажатии кнопки, а не признак того, что с доступом сейчас всё хорошо. Про
  // текущее состояние говорят лозенг и раздел Slack, и они никуда не денутся.
  const [message, setMessage] = useTransientMessage();
  const [testResults, setTestResults] = useState(null);

  // Резолверы доступов отвечают целиком {credentials, slack}: подключение Slack
  // и наличие токена меняются вместе, и разъезжаться в состоянии страницы им
  // нельзя. Ссылка стабильна — на неё завязан опрос в SlackConnection.
  const onResult = useCallback(
    (result) => {
      onCredentialsChange(result);
      setTestResults(null);
    },
    [onCredentialsChange]
  );

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      setTestResults(await api.testConnections());
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Stack space="space.300">
      <Stack space="space.150">
        <Heading as="h3" size="medium">Access</Heading>
        <Text>
          The app talks to Slack and Tempo on its own schedule, so it needs its own access to both.
          Slack is connected with a button; the Tempo token you issue in Tempo and paste here.
        </Text>
      </Stack>

      <SlackConnection
        slack={slack}
        credentials={credentials}
        onResult={onResult}
        onMessage={setMessage}
      />

      <Stack space="space.150">
        <Heading as="h4" size="small">Tempo</Heading>
        <TokenField
          name="tempoToken"
          title="Tempo API token"
          hint="Tempo → Settings → API integration → New token. Needs read access to worklogs."
          status={credentials.tempoToken ?? { isSet: false }}
          onResult={onResult}
          onMessage={setMessage}
          removeWarning="Until a new token is set, every run fails on the Tempo side: no worklogs are read, so nobody can be checked."
        />
      </Stack>

      <Stack space="space.150">
        <Inline space="space.100">
          <LoadingButton isLoading={isTesting} onClick={test}>
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
      </Stack>
    </Stack>
  );
};
