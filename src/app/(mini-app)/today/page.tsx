import { redirect } from 'next/navigation'

/**
 * Старый адрес «Моего дня».
 *
 * Экрана больше нет, но адрес зашит в кнопку меню бота (WEBAPP_URL) и в
 * прежние уведомления, поэтому ведёт туда же, куда и корень приложения, —
 * в рабочую половину. Личные дела рядом, в нижней навигации.
 */
export default function TodayRedirect() {
  redirect('/tracker')
}
