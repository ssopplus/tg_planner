'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Star } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'

/**
 * Раздел настроек «Очереди Трекера»: привязка очередей Яндекс.Трекера к
 * проектам планировщика. Это единственное место, где связки правятся —
 * синк раскладывает тикеты именно по ним.
 *
 * Одна очередь может вести в несколько проектов. Тогда у связок задаётся
 * фильтр по подстроке в заголовке тикета (в очереди VDHWEBNEW задачи интура
 * помечены «WEB Интур //»), а связка без фильтра забирает всё остальное.
 */

interface TrackerLink {
  id: string
  queueKey: string
  projectId: string
  projectName: string
  titleFilter: string | null
  isDefaultForProject: boolean
}

interface ProjectOption {
  id: string
  name: string
}

interface QueueOption {
  key: string
  name: string
}

export function TrackerLinksSection() {
  const [links, setLinks] = useState<TrackerLink[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [queues, setQueues] = useState<QueueOption[]>([])
  const [queuesError, setQueuesError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  // Поля формы новой связки
  const [queueKey, setQueueKey] = useState('')
  const [projectId, setProjectId] = useState('')
  const [titleFilter, setTitleFilter] = useState('')
  const [isDefault, setIsDefault] = useState(false)

  const loadLinks = useCallback(async () => {
    const res = await apiFetch('/api/settings/tracker-links')
    if (res.ok) setLinks(await res.json())
  }, [])

  useEffect(() => {
    Promise.all([
      loadLinks(),
      apiFetch('/api/projects').then(async (res) => {
        if (res.ok) setProjects(await res.json())
      }),
      // Очереди приходят из Трекера. Если токен протух, показываем причину и
      // даём ввести ключ очереди руками — настройки не должны блокироваться.
      apiFetch('/api/tracker/queues').then(async (res) => {
        const data = await res.json()
        if (res.ok) setQueues(data)
        else setQueuesError(typeof data?.error === 'string' ? data.error : 'Трекер недоступен')
      }),
    ]).finally(() => setLoading(false))
  }, [loadLinks])

  const handleAdd = useCallback(async () => {
    if (!queueKey.trim() || !projectId) return
    setBusy(true)
    try {
      const res = await apiFetch('/api/settings/tracker-links', {
        method: 'POST',
        body: JSON.stringify({
          queueKey: queueKey.trim(),
          projectId,
          titleFilter: titleFilter.trim() || null,
          isDefaultForProject: isDefault,
        }),
      })
      if (res.ok) {
        await loadLinks()
        setShowForm(false)
        setQueueKey('')
        setTitleFilter('')
        setIsDefault(false)
      } else {
        const data = await res.json().catch(() => null)
        showToast({ kind: 'error', message: data?.error ?? 'Не удалось создать связку' })
      }
    } finally {
      setBusy(false)
    }
  }, [queueKey, projectId, titleFilter, isDefault, loadLinks])

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await apiFetch(`/api/settings/tracker-links?id=${id}`, { method: 'DELETE' })
      if (res.ok) await loadLinks()
      else showToast({ kind: 'error', message: 'Не удалось удалить связку' })
    },
    [loadLinks],
  )

  const handleToggleDefault = useCallback(
    async (link: TrackerLink) => {
      const res = await apiFetch('/api/settings/tracker-links', {
        method: 'PATCH',
        body: JSON.stringify({ id: link.id, isDefaultForProject: !link.isDefaultForProject }),
      })
      if (res.ok) await loadLinks()
      else showToast({ kind: 'error', message: 'Не удалось изменить связку' })
    },
    [loadLinks],
  )

  // Группировка по очереди — так видно, что одна очередь ведёт в разные проекты.
  const byQueue = links.reduce<Record<string, TrackerLink[]>>((acc, link) => {
    ;(acc[link.queueKey] ??= []).push(link)
    return acc
  }, {})

  const queueName = (key: string) => queues.find((q) => q.key === key)?.name

  return (
    <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-2 mb-1">
        <label className="block text-sm font-medium text-[var(--tg-theme-text-color,#000)]">
          Очереди Трекера
        </label>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex-shrink-0 h-7 w-7 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Привязать очередь"
        >
          <Plus className="h-4 w-4 text-[var(--tg-theme-button-color,#007aff)]" />
        </button>
      </div>
      <p className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] mb-3">
        Куда синк складывает задачи из Трекера. Если одна очередь ведёт в несколько
        проектов, задайте фильтр по заголовку — связка без фильтра забирает остальные.
      </p>

      {loading ? (
        <p className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">Загрузка…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">
          Связок нет — задачи из Трекера не будут приезжать.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(byQueue).map(([key, queueLinks]) => (
            <div key={key}>
              <div className="text-xs font-semibold text-[var(--tg-theme-text-color,#000)]">
                {key}
                {queueName(key) && (
                  <span className="font-normal text-[var(--tg-theme-hint-color,#8e8e93)]">
                    {` · ${queueName(key)}`}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {queueLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--tg-theme-text-color,#000)] truncate">
                        {link.projectName}
                      </div>
                      <div className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)] truncate">
                        {link.titleFilter
                          ? `если в заголовке «${link.titleFilter}»`
                          : 'все остальные тикеты'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleDefault(link)}
                      className="flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center active:scale-95 transition-transform"
                      aria-label="Предлагать эту очередь при переносе задач в Трекер"
                      title="Предлагать эту очередь при переносе задач в Трекер"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          link.isDefaultForProject
                            ? 'text-amber-500 fill-amber-500'
                            : 'text-[var(--tg-theme-hint-color,#8e8e93)]/50'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(link.id)}
                      className="flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center active:scale-95 transition-transform"
                      aria-label={`Удалить связку ${link.queueKey} → ${link.projectName}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-500/70" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="mt-3 pt-3 border-t border-[var(--tg-theme-hint-color,#8e8e93)]/15 flex flex-col gap-2">
          {queuesError ? (
            <>
              <p className="text-[11px] text-red-500">{queuesError}</p>
              <input
                type="text"
                value={queueKey}
                onChange={(e) => setQueueKey(e.target.value)}
                placeholder="Ключ очереди, например POLAERP"
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none"
              />
            </>
          ) : (
            <select
              value={queueKey}
              onChange={(e) => setQueueKey(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none appearance-none cursor-pointer"
            >
              <option value="">Выберите очередь…</option>
              {queues.map((q) => (
                <option key={q.key} value={q.key}>
                  {`${q.key} · ${q.name}`}
                </option>
              ))}
            </select>
          )}

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none appearance-none cursor-pointer"
          >
            <option value="">Выберите проект…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={titleFilter}
            onChange={(e) => setTitleFilter(e.target.value)}
            placeholder="Фильтр по заголовку (необязательно), например WEB Интур"
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none"
          />

          <label className="flex items-center gap-2 text-xs text-[var(--tg-theme-text-color,#000)]">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4"
            />
            Предлагать эту очередь при переносе задач проекта в Трекер
          </label>

          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !queueKey.trim() || !projectId}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {busy ? 'Сохранение…' : 'Привязать'}
          </button>
        </div>
      )}
    </div>
  )
}
