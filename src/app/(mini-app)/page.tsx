import { redirect } from 'next/navigation'

/** Главная Mini App — редирект на «Мой день» */
export default function MiniAppHome() {
  redirect('/today')
}
