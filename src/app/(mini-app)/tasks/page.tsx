'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, List, Columns3, FolderOpen, ChevronDown, Check, ArrowUpDown } from 'lucide-react'
import { TaskCard, type TaskCardData } from '@/components/tasks/task-card'
import { KanbanBoard } from '@/components/tasks/kanban-board'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'

interface ProjectOption {
  id: string
  name: string
  isDefault: boolean
}

type SortMode = 'deadline' | 'priority' | 'created'
type ViewMode = 'list' | 'kanban'

const sortOptions: { mode: SortMode; label: string }[] = [
  { mode: 'deadline', label: 'По сроку' },
  { mode: 'priority', label: 'По приоритету' },
  { mode: 'created', label: 'По дате создания' },
]

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('deadline')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([])
  const [showFilter, setShowFilter] = useState(false)
  const [showSort, setShowSort] = useState(false)
  const settingsLoaded = useRef(false)

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
        },
      }),
    })
  }, [sortMode, viewMode, filterProjectIds])

  const fetchTasks = useCallback(async () => {
    try {
      const statusParam = viewMode === 'kanban' ? '&status=TODO,IN_PROGRESS,DONE' : ''
      const projectParam = filterProjectIds.length > 0 ? `&project_ids=${filterProjectIds.join(',')}` : ''
      const res = await apiFetch(`/api/tasks?sort=${sortMode}${statusParam}${projectParam}`)
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [sortMode, viewMode, filterProjectIds])

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
        if (!selectedProjectId) {
          const def = data.find((p) => p.isDefault)
          setSelectedProjectId(def?.id ?? data[0]?.id ?? null)
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = useCallback(async (id: string, done: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: done ? 'DONE' : 'TODO' } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
    })
  }, [])

  const handleMyDayToggle = useCallback(async (id: string, add: boolean) => {
    const todayStr = new Date().toISOString().split('T')[0]
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, myDayDate: add ? todayStr : null } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ myDayDate: add ? todayStr : null }),
    })
  }, [])

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    // Оптимистичное обновление
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }, [])

  const openForm = useCallback(() => {
    setShowForm(true)
  }, [])

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) return
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: newTitle.trim(),
        ...(selectedProjectId && { projectId: selectedProjectId }),
      }),
    })
    if (res.ok) {
      setNewTitle('')
      setShowForm(false)
      fetchTasks()
    }
  }, [newTitle, selectedProjectId, fetchTasks])

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
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

      {/* Панель фильтров: сортировка + проекты */}
      <div className="px-4 pb-3 flex gap-2 relative">
        {/* Сортировка — только в списке */}
        {viewMode === 'list' && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowSort(!showSort); setShowFilter(false) }}
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

        {/* Фильтр по проектам */}
        {projects.length > 1 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowFilter(!showFilter); setShowSort(false) }}
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
                <TaskCard key={task.id} task={task} onToggle={handleToggle} onMyDayToggle={handleMyDayToggle} />
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
