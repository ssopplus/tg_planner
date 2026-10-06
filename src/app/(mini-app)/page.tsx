import { redirect } from 'next/navigation'

/** Главная Mini App — рабочая половина: с неё начинается день. */
export default function MiniAppHome() {
  redirect('/tracker')
}
