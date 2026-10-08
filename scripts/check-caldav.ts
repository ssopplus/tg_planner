import 'dotenv/config'
import { caldavConfig, discoverCalendars, fetchEvents, serverFeatures } from '../src/lib/calendar/caldav'
import { expandOccurrences, parseEvents } from '../src/lib/calendar/ics'

/**
 * Диагностика доступа к Яндекс.Календарю.
 *
 * Запускается до всего остального: если администратор организации запретил
 * сервисные приложения, CalDAV отдаст 401 на любой пароль приложения, и
 * строить поверх этого cron бессмысленно.
 *
 *   pnpm caldav:check
 */
async function main() {
  const config = caldavConfig()
  if (!config) {
    console.error('Не заданы YANDEX_CALDAV_LOGIN и YANDEX_CALDAV_PASSWORD.')
    console.error('Пароль приложения: id.yandex.ru → Безопасность → Пароли приложений → Календарь.')
    process.exit(1)
  }

  console.log(`Сервер: ${config.baseUrl}`)
  console.log(`Логин:  ${config.login}`)
  console.log(`Адрес:  ${config.email}\n`)

  const features = await serverFeatures(config)
  const autoSchedule = features.some((f) => f.includes('calendar-auto-schedule'))
  console.log(`Возможности сервера: ${features.join(', ') || '(пусто)'}`)
  console.log(
    autoSchedule
      ? '✓ Авто-планирование есть: ответ на приглашение уйдёт организатору.\n'
      : '⚠ Авто-планирование не объявлено: ответ может остаться только в моём календаре.\n',
  )

  const calendars = await discoverCalendars(config)
  console.log(`Календарей: ${calendars.length}`)
  for (const cal of calendars) console.log(`  • ${cal.displayName} — ${cal.href}`)

  const from = new Date()
  const to = new Date(from.getTime() + 14 * 86_400_000)
  console.log(`\nВстречи на две недели вперёд:`)

  for (const cal of calendars) {
    const objects = await fetchEvents(config, cal.href, from, to)
    for (const object of objects) {
      for (const event of parseEvents(object.ics)) {
        for (const slot of expandOccurrences(event, from, to)) {
          const me = event.attendees.find((a) => a.email === config.email)
          console.log(
            `  ${slot.start.toLocaleString('ru-RU')} — ${event.summary}` +
              `${me ? ` [${me.partstat}]` : ''}${event.rrule ? ' (повтор)' : ''}`,
          )
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
