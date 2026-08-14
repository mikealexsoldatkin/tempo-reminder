import React from 'react';
import { CodeBlock, SectionMessage, Stack, Text } from '@forge/react';

/**
 * Ошибка рендера в UI Kit роняет всё дерево — страница просто исчезает.
 * Граница ловит её и показывает сообщение вместе с componentStack: имена компонентов
 * в бандле минифицированы, и стек вызовов бесполезен, а componentStack называет цепочку
 * компонентов, в которой произошёл сбой.
 */
export class ErrorBoundary extends React.Component {
  state = { error: null, componentStack: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Ошибка рендера страницы настроек:', error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <SectionMessage appearance="error" title="The settings page failed to render">
        <Stack space="space.100">
          <Text>{error.message ?? String(error)}</Text>
          {componentStack && (
            <CodeBlock text={componentStack.trim().split('\n').slice(0, 12).join('\n')} />
          )}
          <Text>Reload the page, then send the block above — it names the component that failed.</Text>
        </Stack>
      </SectionMessage>
    );
  }
}
