'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'

export default function ReadingRsvpPage() {
  return (
    <StagePlaceholder
      title="Разминка: слова по одному"
      stage={3}
      description="Слова появляются в одной точке с выделенной опорной буквой, темп 150–900 слов/мин, по 1–3 слова за раз. 2 минуты."
    />
  )
}
