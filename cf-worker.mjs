// Точка входа Cloudflare Worker: сервер Next из сборки OpenNext + cron.
// Один cron-триггер раз в минуту (wrangler.jsonc) заменяет задачи cron-job.org: по времени UTC
// решаем, какие /api/cron/* дёрнуть, и вызываем их тем же обработчиком с CRON_SECRET.
import handler from './.open-next/worker.js'

/** Расписание в UTC (МСК = UTC+3). Источник — docs/cron-setup.md. */
const JOBS = [
  { path: '/api/cron/reminders', when: () => true },                                   // каждую минуту
  { path: '/api/cron/pending-cleanup', when: (d) => d.getUTCMinutes() % 5 === 0 },      // каждые 5 мин
  { path: '/api/cron/digest', when: (d) => d.getUTCMinutes() % 15 === 0 },              // каждые 15 мин
  { path: '/api/cron/calendar-sync', when: (d) => d.getUTCMinutes() % 15 === 7 },       // каждые 15 мин, со сдвигом
  { path: '/api/cron/tracker-sync', when: (d) => d.getUTCMinutes() % 30 === 3 },        // каждые 30 мин, со сдвигом
  { path: '/api/cron/archive', when: (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 11 }, // 03:11 МСК
  {
    path: '/api/cron/coordination-poll',                                                // будни 16:00 МСК
    when: (d) => d.getUTCHours() === 13 && d.getUTCMinutes() === 0 && d.getUTCDay() >= 1 && d.getUTCDay() <= 5,
  },
]

export default {
  fetch: handler.fetch,

  async scheduled(controller, env, ctx) {
    const at = new Date(controller.scheduledTime)
    const base = env.APP_URL || 'https://tg-planner.invalid'
    // Задачи идут по очереди в одном вызове: контекст общий, значит и подключение к БД общее.
    for (const job of JOBS.filter((j) => j.when(at))) {
      const req = new Request(new URL(job.path, base), { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })
      try {
        const res = await handler.fetch(req, env, ctx)
        const body = await res.text()
        if (!res.ok) console.error('cron', job.path, res.status, body.slice(0, 300))
      } catch (e) {
        console.error('cron', job.path, e?.message ?? e)
      }
    }
  },
}
