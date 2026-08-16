import React from 'react';
import { Box, Heading, Inline, SectionMessage, Stack, Text, xcss } from '@forge/react';

/**
 * Общая раскладка вкладок: шапка и панели.
 *
 * До этого каждая вкладка была одним длинным столбцом из заголовков, чекбоксов,
 * таблиц и кнопок — всё на одном фоне, и глазу не за что зацепиться: где кончается
 * одна настройка и начинается другая, видно только по расстоянию между строками.
 * Здесь у вкладки появляется постоянная форма: сверху шапка (что это за вкладка,
 * главное действие и сообщение о результате), ниже — панели, по одной на смысловой
 * блок. Панели можно ставить и рядом (см. columnStyles), когда блоки узкие.
 *
 * Всё оформление — токенами дизайн-системы, а не своими цветами: страница живёт
 * внутри Jira и должна менять вид вместе с ней, включая тёмную тему.
 */

const panelStyles = xcss({
  padding: 'space.200',
  backgroundColor: 'elevation.surface',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.large',
});

// Шапка отделена от панелей фоном, а не рамкой: рамка вокруг рамок превращает
// вкладку в набор коробок, а тут нужно только сказать «это про всю вкладку».
const headerStyles = xcss({
  padding: 'space.200',
  backgroundColor: 'elevation.surface.sunken',
  borderRadius: 'radius.large',
});

// Текст забирает свободное место, иначе кнопки липнут к последнему слову вместо
// правого края; minWidth ломает ряд, когда места на две колонки уже нет.
const headerTextStyles = xcss({ flexGrow: 1, minWidth: '280px' });

/**
 * Панель, стоящая в ряд с соседней: Grid в UI Kit нет, поэтому колонки делает
 * Inline с переносом — flexGrow растягивает панели на равную ширину, а minWidth
 * задаёт, при какой ширине ряд ломается в столбик.
 */
export const columnStyles = xcss({ flexGrow: 1, minWidth: '340px' });

/** Шапка вкладки: название, пояснение, главные действия и сообщение о результате. */
export const TabHeader = ({ title, description, aside, actions, message }) => (
  <Box xcss={headerStyles}>
    <Stack space="space.150">
      <Inline space="space.200" alignBlock="center" spread="space-between" shouldWrap>
        <Box xcss={headerTextStyles}>
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center">
              <Heading as="h3" size="medium">{title}</Heading>
              {aside}
            </Inline>
            {typeof description === 'string' ? <Text>{description}</Text> : description}
          </Stack>
        </Box>
        {actions && (
          <Inline space="space.100" alignBlock="center" shouldWrap>
            {actions}
          </Inline>
        )}
      </Inline>

      {message && (
        <SectionMessage appearance={message.appearance}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}
    </Stack>
  </Box>
);

/**
 * Панель — один смысловой блок вкладки. Заголовок и действия необязательны:
 * блоки, у которых заголовок свой (подключения Slack и Tempo, таблицы людей),
 * получают только рамку и отступы.
 */
export const Panel = ({ title, aside, actions, children }) => (
  <Box xcss={panelStyles}>
    <Stack space="space.150">
      {(title || actions) && (
        <Inline space="space.200" alignBlock="center" spread="space-between" shouldWrap>
          <Inline space="space.100" alignBlock="center">
            {title && <Heading as="h4" size="small">{title}</Heading>}
            {aside}
          </Inline>
          {actions && (
            <Inline space="space.100" alignBlock="center" shouldWrap>
              {actions}
            </Inline>
          )}
        </Inline>
      )}
      {children}
    </Stack>
  </Box>
);

/** Панель в колонке: то же самое, но растягивается в ряду с соседней. */
export const PanelColumn = ({ children, ...props }) => (
  <Box xcss={columnStyles}>
    <Panel {...props}>{children}</Panel>
  </Box>
);
