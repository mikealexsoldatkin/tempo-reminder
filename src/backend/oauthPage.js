/**
 * Страница, которую видит администратор, вернувшись из Slack или из Tempo.
 *
 * Отдаётся целиком из функции: веб-триггеры — единственное место приложения, где
 * на экран смотрит не UI Kit, а браузер, и ссылаться отсюда не на что — внешние
 * файлы такой странице недоступны.
 */
export function page(statusCode, title, text) {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: #f7f8f9; color: #172b4d; }
  main { max-width: 30rem; padding: 2rem; background: #fff; border-radius: 6px;
         box-shadow: 0 1px 3px rgba(9, 30, 66, .25); }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0; line-height: 1.6; color: #44546f; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body>
</html>`;

  return {
    statusCode,
    statusText: statusCode < 400 ? 'OK' : 'Error',
    headers: {
      'Content-Type': ['text/html; charset=utf-8'],
      // В адресе этой страницы едет одноразовый code — в кэше ему не место.
      'Cache-Control': ['no-store'],
    },
    body,
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
