'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'

export default function ReadingSilentPage() {
  return (
    <StagePlaceholder
      title="Без голоса"
      stage={3}
      description="Чтение под пульс четырёх точек: внутренний голос занят счётом. Можно приглушить служебные слова и включить щелчок. 5 минут."
    />
  )
}
