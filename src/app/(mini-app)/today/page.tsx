import { redirect } from 'next/navigation'

/**
 * «Мой день» больше нет: его роль играет колонка «Сегодня» на досках, а
 * рабочие задачи живут в разделе Трекера. Адрес остался в старых ссылках
 * бота, поэтому ведём его на доски, а не отдаём 404.
 */
export default function TodayRedirect() {
  redirect('/boards')
}
