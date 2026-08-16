import React, { useCallback, useState } from 'react';
import { Inline, LoadingButton, Stack } from '@forge/react';
import { api } from '../api';
import { SlackConnection } from './SlackConnection';
import { TempoConnection } from './TempoConnection';
import { PanelColumn, TabHeader } from './layout';
import { useTransientMessage } from './useTransientMessage';

/**
 * Подключения к двум внешним системам. Обе подключаются кнопкой: приложение само
 * получает токен по OAuth и кладёт его в секретное хранилище. Полей для ручного
 * ввода на вкладке нет ни у одной — токены, вставленные в прежних версиях,
 * продолжают работать и заменяются тем же нажатием кнопки.
 *
 * Значение уезжает в секретное хранилище Forge (kvs.setSecret) и наружу не
 * возвращается: UI видит только «задан / не задан», последние 4 символа и дату
 * обновления.
 *
 * Раскладка: шапка с общей проверкой, под ней две равные панели — Slack и Tempo.
 * В столбик они читались как один длинный список, в котором лозенг одной системы
 * стоит вплотную к кнопке другой; рядом же видно главное — работают обе или нет.
 * Итог проверки уезжает в панель той системы, к которой относится: возвращать его
 * к кнопке значило бы заставлять глаз ходить туда-сюда.
 */
export const CredentialsTab = ({ credentials, slack, tempo, onCredentialsChange }) => {
  const [isTesting, setTesting] = useState(false);
  // Сообщения об успехе гаснут сами: «Tempo is connected» — это отчёт о нажатии
  // кнопки, а не признак того, что с доступом сейчас всё хорошо. Про текущее
  // состояние говорят лозенги в панелях, и они никуда не денутся.
  const [message, setMessage] = useTransientMessage();
  const [testResults, setTestResults] = useState(null);

  // Резолверы доступов отвечают целиком {credentials, slack, tempo}: подключение
  // и его токен меняются вместе, и разъезжаться в состоянии страницы им нельзя.
  // Ссылка стабильна — на неё завязан опрос в SlackConnection и TempoConnection.
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
      const results = await api.testConnections();
      setTestResults(results);
      // Проверка — ещё и способ узнать, что доступ отозвали на той стороне:
      // резолвер отдаёт вместе с итогами обновлённое состояние подключений.
      if (results.state) onCredentialsChange(results.state);
    } catch (e) {
      setMessage({ appearance: 'error', text: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Stack space="space.200">
      <TabHeader
        title="Connections"
        description="The app talks to Slack and Tempo on its own schedule, so it needs its own access to both. Each is connected with a button — the app gets the token itself and keeps it alive."
        message={message}
        actions={
          <LoadingButton isLoading={isTesting} onClick={test}>
            Test connections
          </LoadingButton>
        }
      />

      <Inline space="space.200" alignBlock="stretch" shouldWrap>
        <PanelColumn>
          <SlackConnection
            slack={slack}
            credentials={credentials}
            testResult={testResults?.slack}
            onResult={onResult}
            onMessage={setMessage}
          />
        </PanelColumn>
        <PanelColumn>
          <TempoConnection
            tempo={tempo}
            credentials={credentials}
            testResult={testResults?.tempo}
            onResult={onResult}
            onMessage={setMessage}
          />
        </PanelColumn>
      </Inline>
    </Stack>
  );
};
