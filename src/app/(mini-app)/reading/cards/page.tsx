'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'

export default function ReadingCardsPage() {
  return (
    <StagePlaceholder
      title="Карточки слов"
      stage={4}
      description="Интервальное повторение: «Не помню» / «С трудом» / «Помню», интервалы от 1 дня до 4 месяцев. Позже — повторение прямо в чате бота."
    />
  )
}
