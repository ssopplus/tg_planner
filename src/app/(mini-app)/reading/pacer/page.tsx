'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'

export default function ReadingPacerPage() {
  return (
    <StagePlaceholder
      title="Указка"
      stage={3}
      description="Подсветка идёт по строкам текста в заданном темпе, прочитанное приглушается. По окончании — предложение поднять темп на 10%. 5 минут."
    />
  )
}
