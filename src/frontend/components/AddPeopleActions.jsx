import React, { useState } from 'react';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
} from '@forge/react';
import { AddByNameSection } from './AddByNameSection';
import { AddByProjectSection } from './AddByProjectSection';

/**
 * Кнопки добавления людей и сами формы поиска, спрятанные во всплывающие окна.
 *
 * Раньше обе формы стояли постоянным блоком над таблицами и отжимали списки вниз,
 * хотя нужны они редко — список людей заводят один раз, а смотрят на него всегда.
 * Поэтому на странице остаются только кнопки, а поиск с таблицей кандидатов
 * открывается поверх неё.
 *
 * Компонент возвращает фрагмент, а не свою обёртку: кнопки встают прямо в ряд
 * действий таблицы (PeopleTable), рядом с «Remove selected» и «Clear selection», —
 * это один и тот же ряд, а не вторая строка под ним.
 *
 * `action` — куда добавляем; он же решает и набор кнопок. У менеджеров это только
 * поиск по имени: целым проектом менеджеров не назначают. Внутри окна выбора уже
 * нет — кнопка там называется просто «Add».
 *
 * Состояние поиска живёт внутри секций и умирает вместе с окном — закрыл, значит
 * начал заново. Добавленные люди при этом уже уехали наверх через onUsersChange
 * и onManagersChange, и таблицы под окном обновляются сразу.
 */
const DIALOGS = {
  manager: [{ key: 'name', label: 'Add managers' }],
  track: [
    { key: 'name', label: 'Add users' },
    { key: 'project', label: 'Add project members' },
  ],
};

export const AddPeopleActions = ({
  action,
  trackedIds,
  managerIds,
  onUsersChange,
  onManagersChange,
}) => {
  const [openKey, setOpenKey] = useState(null);
  const close = () => setOpenKey(null);

  const dialogs = DIALOGS[action];
  const open = dialogs.find((dialog) => dialog.key === openKey);

  return (
    <>
      {dialogs.map((dialog, index) => (
        <Button
          key={dialog.key}
          appearance={index === 0 ? 'primary' : 'default'}
          onClick={() => setOpenKey(dialog.key)}
        >
          {dialog.label}
        </Button>
      ))}

      <ModalTransition>
        {open && (
          <Modal width="x-large" onClose={close}>
            <ModalHeader>
              <ModalTitle>{open.label}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {open.key === 'name' ? (
                <AddByNameSection
                  action={action}
                  trackedIds={trackedIds}
                  managerIds={managerIds}
                  onUsersChange={onUsersChange}
                  onManagersChange={onManagersChange}
                />
              ) : (
                <AddByProjectSection
                  trackedIds={trackedIds}
                  managerIds={managerIds}
                  onUsersChange={onUsersChange}
                  onManagersChange={onManagersChange}
                />
              )}
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={close}>
                Close
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </>
  );
};
