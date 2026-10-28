'use client'

import { useState } from 'react'
import { StartTaskButton } from './start-task-button'
import { hint } from './session-parts'

/**
 * «Дальше по плану»: сессия своё сделала (задачи на ревью или закрыты, план
 * заметки выполнен) — следующая задача из плана проекта в cockpit. По нажатию
 * раскрываются кнопки запуска, как на карточке задачи.
 */
export function NextFromPlan({ next }: { next: { key: string; summary: string } }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-fit text-left text-[12.5px] leading-snug text-[var(--tg-theme-link-color,#007aff)]"
      >
        ▶ Дальше по плану: <b>{next.key}</b>
        {next.summary ? <span className={hint}> · {next.summary}</span> : null}
      </button>
      {open ? <StartTaskButton issueKey={next.key} title={next.summary} /> : null}
    </div>
  )
}
