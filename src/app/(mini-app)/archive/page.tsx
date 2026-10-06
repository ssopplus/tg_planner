'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { EmptyState } from '@/components/ui/empty-state'

interface VaultTask {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED'
  vaultPath: string | null
  completedAt: string | null
}

interface VaultGroup {
  projectId: string | null
  projectName: string
  tasks: VaultTask[]
}

/**
 * Задачи из Obsidian-vault — только для просмотра.
 *
 * Они ведутся в самом Obsidian (`tasks.md` проекта) и приезжают сюда
 * синхронизацией. Редактирования здесь нет намеренно: правка разъехалась бы
 * с файлом при следующем прогоне синка, а источником остаётся заметка.
 */
export default function ArchivePage() {
  const [groups, setGroups] = useState<VaultGroup[]>([])
  const [withDone, setWithDone] = useState(false)
  const [openProject, setOpenProject] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (done: boolean) => {
    try {
      const res = await apiFetch(`/api/vault${done ? '?done=1' : ''}`)
      if (res.ok) setGroups((await res.json()) as VaultGroup[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(withDone)
  }, [withDone, load])

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-[var(--tg-theme-text-color,#000)]">Архив Obsidian</h1>
        <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-2.5 py-1 text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          только чтение
        </span>
      </div>

      <p className="text-[12px] leading-snug text-[var(--tg-theme-hint-color,#8e8e93)]">
        Задачи из <span className="font-mono">tasks.md</span> в vault. Правятся в Obsidian — здесь
        видно, что там накопилось.
      </p>

      <button
        type="button"
        onClick={() => setWithDone((v) => !v)}
        className="w-fit rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[12px] text-[var(--tg-theme-text-color,#000)]"
      >
        {withDone ? 'Скрыть выполненные' : 'Показать выполненные'}
      </button>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
          Загружаю…
        </p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="📓"
          title="Из vault ничего не приехало"
          description="Задачи синхронизируются из tasks.md проектов в Obsidian."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const key = group.projectId ?? 'none'
            const isOpen = openProject === key
            return (
              <section
                key={key}
                className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)]"
              >
                <button
                  type="button"
                  onClick={() => setOpenProject(isOpen ? null : key)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left"
                >
                  <span className="text-[14px] font-semibold text-[var(--tg-theme-text-color,#000)]">
                    {group.projectName}
                  </span>
                  <span className="text-[12px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
                    {group.tasks.length}
                  </span>
                </button>

                {isOpen ? (
                  <ul className="flex flex-col gap-1.5 px-3 pb-3">
                    {group.tasks.map((task) => (
                      <li key={task.id} className="min-w-0">
                        <p
                          className={`text-[13px] leading-snug ${
                            task.status === 'DONE'
                              ? 'text-[var(--tg-theme-hint-color,#8e8e93)] line-through'
                              : 'text-[var(--tg-theme-text-color,#000)]'
                          }`}
                        >
                          {task.title}
                        </p>
                        {task.vaultPath ? (
                          <p className="truncate font-mono text-[10px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                            {task.vaultPath}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
