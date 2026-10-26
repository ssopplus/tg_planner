'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'

export default function ReadingEnglishPage() {
  return (
    <StagePlaceholder
      title="Чтение на английском"
      stage={4}
      description="Нажатие на слово показывает перевод в контексте: глоссарий текста, кэш, затем AI. Слово можно добавить в карточки."
    />
  )
}
