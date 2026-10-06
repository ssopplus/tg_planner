import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Старый адрес карточки задачи.
 *
 * Уведомления бота, отправленные до переработки, ведут сюда, поэтому адрес
 * остаётся рабочим: смотрим, откуда задача, и отправляем в нужную половину.
 * Данные здесь не показываются — только перенаправление, так что обойтись
 * без initData можно: id задачи это UUID, его не подобрать.
 */
export default async function LegacyTaskRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [task] = await db
    .select({ externalSource: tasks.externalSource })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1)

  if (!task) redirect('/tracker')
  redirect(task.externalSource ? `/tracker/${id}` : `/boards/task/${id}`)
}
