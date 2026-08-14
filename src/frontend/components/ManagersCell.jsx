import React from 'react';
import { CheckboxGroup, InlineEdit, Text } from '@forge/react';

/**
 * Редактор одного набора менеджеров сотрудника. В таблице таких колонки две —
 * получатели дайджеста «не отчитался» и получатели детального отчёта, — поэтому
 * сам набор приходит пропом `assignedIds`, а не читается из person.
 *
 * У Select в UI Kit нет компонента Option — options ему передать нечем
 * (@forge/react 12.1.1 экспортирует только сам 'Select'). Поэтому множественный
 * выбор собран на CheckboxGroup: клик по ячейке раскрывает список менеджеров
 * с галочками, отмечаем нужных и подтверждаем — сохранение как у остальных
 * инлайн-полей.
 *
 * Список галочек CheckboxGroup задаётся только массивом options: дочерние
 * <Checkbox> он не читает, а рендерер безусловно делает options.map() — без пропа
 * ячейка падает с «undefined is not an object (evaluating 'a.map')».
 * Отмеченные значения тоже приходят из группы (defaultValue), не с отдельных
 * галочек.
 *
 * Компонент без хуков намеренно: его вызывает DynamicTable прямо в своём рендере,
 * см. комментарий к EmailCell в PeopleTable.jsx.
 */
export const ManagersCell = ({
  person,
  assignedIds,
  managers,
  onConfirm,
  emptyLabel = '— none',
  field = 'managers',
}) => {
  const assigned = new Set(assignedIds ?? []);
  const names = managers.filter((m) => assigned.has(m.accountId)).map((m) => m.displayName);

  if (managers.length === 0) {
    return <Text>— add someone to Managers first</Text>;
  }

  return (
    <InlineEdit
      defaultValue={[...assigned]}
      editView={(fieldProps) => (
        <CheckboxGroup
          // Имя группы должно быть уникальным в пределах страницы: у одного
          // человека таких колонок две, и на одинаковом name браузер связал бы
          // их галочки между собой.
          name={`${field}-${person.accountId}`}
          defaultValue={[...assigned]}
          options={managers.map((manager) => ({
            value: manager.accountId,
            label: manager.displayName,
          }))}
          onChange={fieldProps.onChange}
        />
      )}
      readView={() => <Text>{names.length > 0 ? names.join(', ') : emptyLabel}</Text>}
      onConfirm={onConfirm}
    />
  );
};
