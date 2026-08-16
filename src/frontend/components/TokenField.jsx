import React, { useState } from 'react';
import {
  Form,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { api } from '../api';
import { formatInstant } from '../formatTime';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Поле для секрета, который вводят руками: Tempo-токен и — в разделе «Advanced»
 * вкладки — bot-токен Slack.
 *
 * Значения кладутся в секретное хранилище Forge и наружу не возвращаются, поэтому
 * поле всегда пустое, а про текущее состояние говорит лозенг рядом с подписью:
 * «задан», хвост значения и дата обновления.
 *
 * @param name
 * @param title
 * @param hint
 * @param status
 * @param {(result: object) => void} onResult результат резолвера {credentials, slack}
 * @param {(message: object|null) => void} onMessage сообщение о результате действия
 * @param removeWarning
 */
export const TokenField = ({ name, title, hint, status, onResult, onMessage, removeWarning }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(null);
  const [isConfirmingRemove, setConfirmingRemove] = useState(false);
  const isSet = Boolean(status?.isSet);

  const withBusy = async (key, action) => {
    setBusy(key);
    onMessage(null);
    try {
      await action();
    } catch (e) {
      onMessage({ appearance: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  // Пустое поле «сохранить» не значит ничего: кнопка в этом случае заблокирована,
  // а Enter в пустом поле форму всё же отправляет — его и отсекаем.
  const save = () => {
    if (value.trim().length === 0) return undefined;
    return withBusy('save', async () => {
      onResult(await api.saveCredential(name, value));
      setValue('');
      onMessage({ appearance: 'success', text: 'Token saved' });
    });
  };

  const remove = async () => {
    await withBusy('remove', async () => {
      onResult(await api.clearCredential(name));
      onMessage({ appearance: 'information', text: 'Token removed' });
    });
    setConfirmingRemove(false);
  };

  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Label labelFor={`credential-${name}`}>{title}</Label>
        {isSet ? (
          <Lozenge appearance="success">set {status.maskedTail}</Lozenge>
        ) : (
          <Lozenge appearance="removed">not set</Lozenge>
        )}
      </Inline>
      {/* Форма ради Enter: Textfield в UI Kit не принимает onKeyDown, и
          вставленный в поле токен иначе не сохранить, не целясь в кнопку. */}
      <Form onSubmit={save}>
        <Inline space="space.100" alignBlock="end">
          <Textfield
            id={`credential-${name}`}
            type="password"
            width={340}
            value={value}
            placeholder={isSet ? 'Enter a new value to replace it' : 'Paste the token'}
            onChange={(e) => setValue(e.target.value)}
          />
          <LoadingButton
            appearance="primary"
            type="submit"
            isLoading={busy === 'save'}
            isDisabled={value.trim().length === 0}
          >
            Save
          </LoadingButton>
          {/* type="button" обязателен: внутри формы кнопка по умолчанию
              отправляет её, и «Remove» сохранял бы токен. */}
          <LoadingButton
            appearance="subtle"
            type="button"
            isLoading={busy === 'remove'}
            isDisabled={!isSet}
            onClick={() => setConfirmingRemove(true)}
          >
            Remove
          </LoadingButton>
        </Inline>
      </Form>
      <HelperMessage>
        {hint}
        {status?.updatedAt ? ` Updated: ${formatInstant(status.updatedAt)}.` : ''}
      </HelperMessage>

      {/* Токен из секретного хранилища не читается — «Remove» стирает единственный
          экземпляр значения, и восстановить его нечем. Поэтому спрашиваем. */}
      <ConfirmDialog
        isOpen={isConfirmingRemove}
        title="Remove the token?"
        confirmLabel="Remove token"
        isBusy={busy === 'remove'}
        onConfirm={remove}
        onCancel={() => setConfirmingRemove(false)}
      >
        <Stack space="space.100">
          <Text>
            The {title} will be deleted from Forge secret storage. The app never reads it back, so
            nothing here can restore it — you would have to issue a new one.
          </Text>
          <Text>{removeWarning}</Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
};
