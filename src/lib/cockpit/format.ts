/**
 * Главное во входе инструмента: команда, SQL, адрес, файл — иначе весь JSON.
 * Общая для сообщения бота и экрана «Сессии», поэтому без серверных импортов.
 */
export function requestBody(toolName: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null)
  if (toolName === 'Bash') return str('command') ?? ''
  for (const k of ['sql', 'query', 'url', 'file_path', 'notebook_path', 'pattern']) {
    const v = str(k)
    if (v && Object.keys(input).length <= 2) return v
  }
  return JSON.stringify(input, null, 2)
}
