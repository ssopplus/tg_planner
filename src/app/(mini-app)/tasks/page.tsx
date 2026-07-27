'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Plus,
  List,
  Columns3,
  FolderOpen,
  ChevronDown,
  Check,
  ArrowUpDown,
  CircleDot,
  Search,
  X,
} from 'lucide-react'
import { TaskCard, type TaskCardData } from '@/components/tasks/task-card'
import { KanbanBoard } from '@/components/tasks/kanban-board'
import { QuickCaptureBar } from '@/components/tasks/quick-capture-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'
import { mutateSafely } from '@/lib/api/mutate'
import { showToast } from '@/lib/api/toast'

interface ProjectOption {
  id: string
  name: string
  isDefault: boolean
}

type SortMode = 'deadline' | 'priority' | 'created'
type ViewMode = 'list' | 'kanban'
type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED'

const sortOptions: { mode: SortMode; label: string }[] = [
  { mode: 'deadline', label: 'По сроку' },
  { mode: 'priority', label: 'По приоритету' },
  { mode: 'created', label: 'По дате создания' },
]

const statusOptions: { status: TaskStatus; label: string }[] = [
  { status: 'TODO', label: 'Активные' },
  { status: 'IN_PROGRESS', label: 'В работе' },
  { status: 'DONE', label: 'Выполненные' },
]

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('deadline')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([])
  const [filterStatuses, setFilterStatuses] = useState<TaskStatus[]>([])
  const [showFilter, setShowFilter] = useState(false)
  const [showStatusFilter, setShowStatusFilter] = useState(false)
  const [showSort, setShowSort] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const settingsLoaded = useRef(false)

  // Дебаунс поиска: обновляем query, из которого fetchTasks строит URL.
  // Даёт паузу 250мс между нажатиями клавиш и запросом к API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Загрузка сохранённых настроек
  useEffect(() => {
    apiFetch('/api/settings').then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      const s = data.settings as Record<string, unknown> | undefined
      if (s?.tasksSortMode && typeof s.tasksSortMode === 'string') {
        setSortMode(s.tasksSortMode as SortMode)
      }
      if (s?.tasksViewMode && typeof s.tasksViewMode === 'string') {
        setViewMode(s.tasksViewMode as ViewMode)
      }
      if (Array.isArray(s?.tasksFilterProjectIds)) {
        setFilterProjectIds(s.tasksFilterProjectIds as string[])
      }
      if (Array.isArray(s?.tasksFilterStatuses)) {
        setFilterStatuses(s.tasksFilterStatuses as TaskStatus[])
      }
      settingsLoaded.current = true
    })
  }, [])

  // Сохранение настроек при изменении (после первой загрузки)
  useEffect(() => {
    if (!settingsLoaded.current) return
    apiFetch('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        settings: {
          tasksSortMode: sortMode,
          tasksViewMode: viewMode,
          tasksFilterProjectIds: filterProjectIds,
          tasksFilterStatuses: filterStatuses,
        },
      }),
    })
  }, [sortMode, viewMode, filterProjectIds, filterStatuses])

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sort: sortMode })
      if (filterProjectIds.length > 0) {
        params.set('project_ids', filterProjectIds.join(','))
      }
      // В kanban-режиме всегда показываем все три статуса по колонкам,
      // в list-режиме применяем выбранный фильтр (пустой = backend default).
      if (viewMode === 'kanban') {
        params.set('status', 'TODO,IN_PROGRESS,DONE')
      } else if (filterStatuses.length > 0) {
        params.set('status', filterStatuses.join(','))
      }
      // При активном поиске: расширяем область до всех статусов, чтобы
      // выполненные/архивные задачи находились тоже.
      if (debouncedQuery) {
        params.set('q', debouncedQuery)
        params.set('status', 'TODO,IN_PROGRESS,DONE,ARCHIVED')
      }
      const res = await apiFetch(`/api/tasks?${params.toString()}`)
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [sortMode, viewMode, filterProjectIds, filterStatuses, debouncedQuery])

  useEffect(() => {
    setLoading(true)
    fetchTasks()
  }, [fetchTasks])

  // Загрузка проектов при монтировании (для фильтра)
  useEffect(() => {
    apiFetch('/api/projects').then(async (res) => {
      if (res.ok) {
        const data: ProjectOption[] = await res.json()
        setProjects(data)
        setProjectsLoaded(true)
        if (!selectedProjectId) {
          const def = data.find((p) => p.isDefault)
          setSelectedProjectId(def?.id ?? data[0]?.id ?? null)
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Санитайз фильтра: убираем id удалённых проектов, застрявшие в настройках.
  // Иначе фильтр «залипает» на несуществующем проекте и снять его нечем
  // (в дропдауне такого проекта нет). Ждём, пока приедут и настройки,
  // и список проектов, чтобы не вырезать всё раньше времени. Отфильтрованный
  // список сам сохранится в БД эффектом сохранения настроек выше.
  useEffect(() => {
    if (!settingsLoaded.current || !projectsLoaded) return
    setFilterProjectIds((prev) => {
      const valid = prev.filter((id) => projects.some((p) => p.id === id))
      return valid.length === prev.length ? prev : valid
    })
  }, [projectsLoaded, projects])

  const handleToggle = useCallback(async (id: string, done: boolean) => {
    const newStatus = done ? 'DONE' : 'TODO'
    const prevStatus = tasks.find((t) => t.id === id)?.status
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)))
    await mutateSafely({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      body: { status: newStatus },
      label: done ? 'Отметка задачи выполненной' : 'Снятие отметки',
      onRollback: () => {
        if (prevStatus) {
          setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: prevStatus } : t)))
        }
      },
    })
  }, [tasks])

  // === Мультивыбор ===
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectionMode = selectedIds.size > 0

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const enterSelection = useCallback((id: string) => {
    setSelectedIds(new Set([id]))
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const runBulk = useCallback(
    async (
      action: 'done' | 'todo' | 'delete' | 'assign',
      opts?: { projectId?: string; label: string },
    ) => {
      const ids = Array.from(selectedIds)
      if (ids.length === 0) return
      const label = opts?.label ?? 'Массовое действие'
      // Оптимистично убираем/меняем задачи локально, откатываем при неудаче.
      const snapshot = tasks
      if (action === 'delete') {
        setTasks((prev) => prev.filter((t) => !selectedIds.has(t.id)))
      } else if (action === 'done' || action === 'todo') {
        const newStatus = action === 'done' ? 'DONE' : 'TODO'
        setTasks((prev) =>
          prev.map((t) => (selectedIds.has(t.id) ? { ...t, status: newStatus } : t)),
        )
      } else if (action === 'assign' && opts?.projectId) {
        const projectName = projects.find((p) => p.id === opts.projectId)?.name ?? null
        setTasks((prev) =>
          prev.map((t) =>
            selectedIds.has(t.id) ? { ...t, projectId: opts.projectId, projectName } : t,
          ),
        )
      }
      clearSelection()

      await mutateSafely({
        method: 'POST',
        url: '/api/tasks/bulk',
        body: { ids, action, ...(opts?.projectId && { projectId: opts.projectId }) },
        label,
        onRollback: () => setTasks(snapshot),
      })
      // Подтянем свежее состояние — счётчики подзадач и прочее могут разойтись.
      fetchTasks()
    },
    [selectedIds, tasks, projects, clearSelection, fetchTasks],
  )

  const [showBulkAssign, setShowBulkAssign] = useState(false)

  const handleMyDayToggle = useCallback(async (id: string, add: boolean) => {
    const todayStr = new Date().toISOString().split('T')[0]
    const prev = tasks.find((t) => t.id === id)?.myDayDate ?? null
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, myDayDate: add ? todayStr : null } : t)))
    await mutateSafely({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      body: { myDayDate: add ? todayStr : null },
      label: add ? 'Добавление в «Мой день»' : 'Удаление из «Моего дня»',
      onRollback: () => {
        setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, myDayDate: prev } : t)))
      },
    })
  }, [tasks])

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    const prevStatus = tasks.find((t) => t.id === id)?.status
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))
    await mutateSafely({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      body: { status },
      label: 'Изменение статуса',
      onRollback: () => {
        if (prevStatus) {
          setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: prevStatus } : t)))
        }
      },
    })
  }, [tasks])

  const openForm = useCallback(() => {
    setShowForm(true)
  }, [])

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) return
    const title = newTitle.trim()
    setNewTitle('')
    setShowForm(false)
    const ok = await mutateSafely({
      method: 'POST',
      url: '/api/tasks',
      body: {
        title,
        ...(selectedProjectId && { projectId: selectedProjectId }),
      },
      label: 'Создание задачи',
    })
    if (ok) {
      showToast({ kind: 'success', message: 'Задача создана', duration: 1500 })
      fetchTasks()
    }
  }, [newTitle, selectedProjectId, fetchTasks])

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      {selectionMode ? (
        <header className="sticky top-0 z-30 pl-4 pr-16 sm:pr-20 pt-4 pb-2 flex items-center gap-3 bg-[var(--tg-theme-bg-color,#f2f2f7)]">
          <button
            type="button"
            onClick={clearSelection}
            className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] flex items-center justify-center active:scale-90 transition-transform"
            aria-label="Отменить выбор"
          >
            <X className="h-4 w-4 text-[var(--tg-theme-text-color,#000)]" />
          </button>
          <h1 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)] flex-1">
            Выбрано: {selectedIds.size}
          </h1>
          <button
            type="button"
            onClick={() => runBulk('done', { label: 'Отметить выполненными' })}
            className="h-9 px-3 rounded-lg bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] text-sm font-medium active:scale-95 transition-transform"
          >
            Готово
          </button>
          <button
            type="button"
            onClick={() => setShowBulkAssign(true)}
            className="h-9 px-3 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)] text-sm font-medium active:scale-95 transition-transform"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Удалить ${selectedIds.size} задач(и)?`)) {
                runBulk('delete', { label: 'Удаление задач' })
              }
            }}
            className="h-9 px-3 rounded-lg bg-red-500/15 text-red-600 text-sm font-medium active:scale-95 transition-transform"
          >
            🗑
          </button>
        </header>
      ) : (
        <header className="pl-4 pr-16 sm:pr-20 pt-4 pb-2 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-[var(--tg-theme-text-color,#000)]">{'📋 Задачи'}</h1>
          <div className="flex gap-1 bg-[var(--tg-theme-secondary-bg-color,#efeff4)] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'list'
                  ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow-sm'
                  : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
              }`}
              aria-label="Список"
            >
              <List className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'kanban'
                  ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow-sm'
                  : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
              }`}
              aria-label="Канбан"
            >
              <Columns3 className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>
      )}

      {/* Модалка выбора проекта для mass-assign */}
      {showBulkAssign && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setShowBulkAssign(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-72 max-w-[90vw] max-h-[70vh] overflow-auto bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg">
            <div className="px-4 py-3 border-b border-[var(--tg-theme-hint-color,#8e8e93)]/10 font-semibold text-[var(--tg-theme-text-color,#000)]">
              Переместить в проект
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setShowBulkAssign(false)
                  runBulk('assign', { projectId: p.id, label: `Перемещение в «${p.name}»` })
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-[var(--tg-theme-text-color,#000)] active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Поиск по названию и описанию */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)] flex-shrink-0" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск задач…"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[var(--tg-theme-hint-color,#8e8e93)] active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
              aria-label="Очистить"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Панель фильтров: сортировка + проекты */}
      <div className="px-4 pb-3 flex flex-wrap gap-2 relative">
        {/* Сортировка — только в списке */}
        {viewMode === 'list' && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowSort(!showSort); setShowFilter(false); setShowStatusFilter(false) }}
              className="text-xs font-medium px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span>{sortOptions.find((s) => s.mode === sortMode)?.label}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showSort ? 'rotate-180' : ''}`} />
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-48 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden">
                  {sortOptions.map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setSortMode(mode); setShowSort(false) }}
                      className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                        sortMode === mode
                          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                          : 'text-[var(--tg-theme-text-color,#000)]'
                      }`}
                    >
                      {sortMode === mode && <Check className="h-3.5 w-3.5" />}
                      {sortMode !== mode && <div className="w-3.5" />}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Фильтр по статусу — только в списке */}
        {viewMode === 'list' && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowStatusFilter(!showStatusFilter)
                setShowFilter(false)
                setShowSort(false)
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                filterStatuses.length > 0
                  ? 'bg-[var(--tg-theme-button-color,#007aff)]/15 text-[var(--tg-theme-button-color,#007aff)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
              }`}
            >
              <CircleDot className="h-3.5 w-3.5" />
              <span className="truncate max-w-[130px]">
                {filterStatuses.length === 0
                  ? 'Активные'
                  : filterStatuses.length === 1
                    ? statusOptions.find((s) => s.status === filterStatuses[0])?.label ?? 'Статус'
                    : `${filterStatuses.length} статуса`}
              </span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showStatusFilter ? 'rotate-180' : ''}`}
              />
              {filterStatuses.length > 0 && (
                <span className="ml-0.5 h-4 w-4 rounded-full bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] text-[10px] flex items-center justify-center font-semibold">
                  {filterStatuses.length}
                </span>
              )}
            </button>
            {showStatusFilter && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusFilter(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFilterStatuses([])}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                      filterStatuses.length === 0
                        ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                        : 'text-[var(--tg-theme-text-color,#000)]'
                    }`}
                  >
                    <div
                      className={`h-4.5 w-4.5 rounded border-2 flex items-center justify-center transition-all ${
                        filterStatuses.length === 0
                          ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                          : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
                      }`}
                    >
                      {filterStatuses.length === 0 && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span className="font-medium">По умолчанию (активные)</span>
                  </button>
                  <div className="h-px bg-[var(--tg-theme-hint-color,#8e8e93)]/10" />
                  {statusOptions.map(({ status, label }) => {
                    const selected = filterStatuses.includes(status)
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          setFilterStatuses((prev) =>
                            selected ? prev.filter((s) => s !== status) : [...prev, status],
                          )
                        }}
                        className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                          selected
                            ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                            : 'text-[var(--tg-theme-text-color,#000)]'
                        }`}
                      >
                        <div
                          className={`h-4.5 w-4.5 rounded border-2 flex items-center justify-center transition-all ${
                            selected
                              ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                              : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
                          }`}
                        >
                          {selected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <span>{label}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Фильтр по проектам */}
        {projects.length > 1 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowFilter(!showFilter); setShowSort(false); setShowStatusFilter(false) }}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                filterProjectIds.length > 0
                  ? 'bg-[var(--tg-theme-button-color,#007aff)]/15 text-[var(--tg-theme-button-color,#007aff)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="truncate max-w-[150px]">
                {filterProjectIds.length === 0
                  ? 'Все проекты'
                  : filterProjectIds.length === 1
                    ? projects.find((p) => p.id === filterProjectIds[0])?.name ?? 'Проект'
                    : `${filterProjectIds.length} проекта`}
              </span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showFilter ? 'rotate-180' : ''}`} />
              {filterProjectIds.length > 0 && (
                <span className="ml-0.5 h-4 w-4 rounded-full bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] text-[10px] flex items-center justify-center font-semibold">
                  {filterProjectIds.length}
                </span>
              )}
            </button>
            {showFilter && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFilter(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFilterProjectIds([])}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                      filterProjectIds.length === 0
                        ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                        : 'text-[var(--tg-theme-text-color,#000)]'
                    }`}
                  >
                    <div className={`h-4.5 w-4.5 rounded border-2 flex items-center justify-center transition-all ${
                      filterProjectIds.length === 0
                        ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                        : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
                    }`}>
                      {filterProjectIds.length === 0 && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span className="font-medium">Все проекты</span>
                  </button>
                  <div className="h-px bg-[var(--tg-theme-hint-color,#8e8e93)]/10" />
                  {projects.map((p) => {
                    const selected = filterProjectIds.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setFilterProjectIds((prev) =>
                            selected ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                          )
                        }}
                        className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                          selected
                            ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                            : 'text-[var(--tg-theme-text-color,#000)]'
                        }`}
                      >
                        <div className={`h-4.5 w-4.5 rounded border-2 flex items-center justify-center transition-all ${
                          selected
                            ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                            : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
                        }`}>
                          {selected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <FolderOpen className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{p.name}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <QuickCaptureBar
        projectId={filterProjectIds.length === 1 ? filterProjectIds[0] : undefined}
        onCreated={fetchTasks}
      />

      {/* Контент */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          tasks={tasks}
          onStatusChange={handleStatusChange}
          onToggle={handleToggle}
        />
      ) : (
        <div className="px-4 pb-24">
          {tasks.length === 0 ? (
            <EmptyState icon="📝" title="Нет активных задач" description="Создайте первую задачу, нажав кнопку +" />
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onMyDayToggle={handleMyDayToggle}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(task.id)}
                  onSelectionToggle={toggleSelection}
                  onLongPress={enterSelection}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom sheet для создания задачи */}
      {showForm && (
        <div
          className="fixed inset-0 z-[60] bg-black/30"
          onClick={() => setShowForm(false)}
        >
          <div
            className="fixed bottom-[calc(3.5rem+max(env(safe-area-inset-bottom,0px),0.5rem)+0.5rem)] left-3 right-3 z-[60] max-w-md mx-auto bg-[var(--tg-theme-section-bg-color,#fff)] rounded-2xl p-4 shadow-lg animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Название задачи..."
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="min-w-0 flex-1 px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)] text-base placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none focus:ring-2 focus:ring-[var(--tg-theme-button-color,#007aff)]/30"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newTitle.trim()}
                className="flex-shrink-0 h-10 w-10 rounded-xl bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-40 transition-opacity active:scale-95 flex items-center justify-center"
                aria-label="Добавить"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
            {/* Выбор проекта */}
            <div className="relative mt-2">
              <button
                type="button"
                onClick={() => setShowProjectPicker(!showProjectPicker)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-xs text-[var(--tg-theme-text-color,#000)] transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[var(--tg-theme-hint-color,#8e8e93)]" />
                <span className="truncate max-w-[200px]">
                  {projects.find((p) => p.id === selectedProjectId)?.name ?? 'Входящие'}
                </span>
                <ChevronDown className={`h-3 w-3 text-[var(--tg-theme-hint-color,#8e8e93)] transition-transform ${showProjectPicker ? 'rotate-180' : ''}`} />
              </button>
              {showProjectPicker && projects.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 w-56 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden z-10">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(p.id)
                        setShowProjectPicker(false)
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                        p.id === selectedProjectId
                          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                          : 'text-[var(--tg-theme-text-color,#000)]'
                      }`}
                    >
                      <FolderOpen className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      {!showForm && (
        <button
          type="button"
          onClick={openForm}
          className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] shadow-lg flex items-center justify-center active:scale-90 transition-transform"
          aria-label="Добавить задачу"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}
    </div>
  )
}
