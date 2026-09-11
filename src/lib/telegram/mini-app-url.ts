/**
 * Сборка ссылок на страницы Mini App из `WEBAPP_URL`.
 *
 * `WEBAPP_URL` исторически хранит не origin, а точку входа вместе с путём
 * (`https://tg-planner.vercel.app/today`) — так кнопка запуска бота открывает
 * приложение сразу на «Моём дне». Поэтому глубокие ссылки нельзя клеить
 * конкатенацией: получалось `/today/tasks/<id>` и 404 в вебвью Telegram.
 * Берём из переменной только origin, путь задаёт вызывающий код.
 */
export function miniAppUrl(path: string): string | undefined {
  const raw = process.env.WEBAPP_URL
  if (!raw) return undefined
  try {
    return new URL(path, new URL(raw).origin).toString()
  } catch {
    // Невалидный URL в конфиге — ведём себя как при отсутствии переменной:
    // кнопки просто не будет, сообщение уйдёт без неё.
    return undefined
  }
}
