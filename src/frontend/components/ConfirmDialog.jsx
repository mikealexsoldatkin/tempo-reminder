import React from 'react';
import {
  Button,
  LoadingButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
} from '@forge/react';

/**
 * Подтверждение необратимого действия — одно на всё приложение.
 *
 * Нужно оно там, где отменить сделанное нельзя ничем, кроме ручного повтора всей
 * настройки: удаление менеджера снимает его со всех сотрудников в обеих колонках
 * получателей, «Restore defaults» затирает календарь целиком, а токен из
 * секретного хранилища не прочитать и не вернуть — только вставить заново.
 *
 * Что именно исчезнет, окно проговаривает текстом (children): «удалить 12 человек»
 * без имён — это то же самое молчание, только с числом. Особенно это важно для
 * массового удаления: отметки живут поперёк страниц пагинации, и часть выделенного
 * в момент нажатия на экране не видна.
 */
export const ConfirmDialog = ({
  isOpen,
  title,
  confirmLabel = 'Remove',
  appearance = 'danger',
  isBusy = false,
  onConfirm,
  onCancel,
  children,
}) => (
  <ModalTransition>
    {isOpen && (
      <Modal onClose={onCancel}>
        <ModalHeader>
          <ModalTitle appearance={appearance}>{title}</ModalTitle>
        </ModalHeader>
        <ModalBody>{children}</ModalBody>
        <ModalFooter>
          <Button appearance="subtle" type="button" isDisabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
          <LoadingButton
            appearance={appearance}
            type="button"
            isLoading={isBusy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </LoadingButton>
        </ModalFooter>
      </Modal>
    )}
  </ModalTransition>
);
