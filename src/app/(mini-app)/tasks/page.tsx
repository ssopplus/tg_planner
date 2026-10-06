import { redirect } from 'next/navigation'

/** Общий список задач разъехался на две половины; по умолчанию — рабочая. */
export default function TasksRedirect() {
  redirect('/tracker')
}
