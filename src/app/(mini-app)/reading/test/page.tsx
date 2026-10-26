'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'

export default function ReadingTestPage() {
  return (
    <StagePlaceholder
      title="Тест скорости"
      stage={2}
      description="Текст открывается по кнопке, таймер считает слова в минуту, потом вопросы на понимание. Эффективная скорость = темп × понимание."
    />
  )
}
