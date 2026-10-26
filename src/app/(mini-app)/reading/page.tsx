'use client'

import { StagePlaceholder } from '@/components/reading/stage-placeholder'
import { useReading } from '@/components/reading/reading-provider'

/** «Сегодня»: план дня, плитки прогресса и график скорости (этап 2). */
export default function ReadingTodayPage() {
  const { texts, lang } = useReading()
  return (
    <>
      <StagePlaceholder
        title="План на сегодня · ~15 минут"
        stage={2}
        description="Разминка 2 мин → Указка 5 мин → Без голоса 5 мин → Тест 3 мин → Карточки → Текст на английском. Пункты отмечаются сами, когда тренировка записана. Ниже появятся скорость последнего теста, понимание, серия дней и график."
      />
      <p className="px-4 text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
        Текстов на {lang === 'ru' ? 'русском' : 'английском'}: {texts.length}
      </p>
    </>
  )
}
