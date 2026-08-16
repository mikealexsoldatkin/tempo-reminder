import React, { useState } from 'react';
import {
  Button,
  Inline,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  Stack,
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
 * Ряд кнопок ставится под каждой из таблиц: добавление из любого окна умеет и
 * поставить под наблюдение, и назначить менеджером, так что кнопка рядом с той
 * таблицей, которую пользователь сейчас заполняет, избавляет от прокрутки к другой.
 *
 * Состояние поиска живёт внутри секций и умирает вместе с окном — закрыл, значит
 * начал заново. Добавленные люди при этом уже уехали наверх через onUsersChange
 * и onManagersChange, и таблицы под окном обновляются сразу.
 */
const DIALOGS = {
  name: { title: 'Search by name', Section: AddByNameSection },
  project: { title: 'Add project members', Section: AddByProjectSection },
};

export const AddPeopleActions = ({ trackedIds, managerIds, onUsersChange, onManagersChange }) => {
  const [openKey, setOpenKey] = useState(null);
  const close = () => setOpenKey(null);
  const Section = openKey ? DIALOGS[openKey].Section : null;

  return (
    <Stack space="space.100">
      <Inline space="space.100">
        <Button appearance="primary" onClick={() => setOpenKey('name')}>
          Search by name
        </Button>
        <Button onClick={() => setOpenKey('project')}>Add project members</Button>
      </Inline>

      <ModalTransition>
        {openKey && (
          <Modal width="x-large" onClose={close}>
            <ModalHeader>
              <ModalTitle>{DIALOGS[openKey].title}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Section
                trackedIds={trackedIds}
                managerIds={managerIds}
                onUsersChange={onUsersChange}
                onManagersChange={onManagersChange}
              />
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={close}>
                Close
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
};
