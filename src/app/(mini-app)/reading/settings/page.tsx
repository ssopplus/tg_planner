'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'
import { useReading } from '@/components/reading/reading-provider'
import { Btn, Chip, Lede, Panel, Toggle, fieldClass } from '@/components/reading/ui'
import { MAX_HABR_FEEDS } from '@/lib/reading/settings'
import type { HabrFeed } from '@/lib/reading/types'

/** Готовые хабы — в одно касание; проверены, что у них есть RSS. */
const HUB_PRESETS: { id: string; label: string }[] = [
  { id: 'artificial_intelligence', label: 'AI' },
  { id: 'machine_learning', label: 'ML' },
  { id: 'programming', label: 'Программирование' },
  { id: 'webdev', label: 'Веб' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'devops', label: 'DevOps' },
  { id: 'open_source', label: 'Open source' },
]

function feedKey(feed: HabrFeed): string {
  return feed.kind === 'hub' ? `hub:${feed.id}` : `q:${feed.q.toLowerCase()}`
}

function feedTitle(feed: HabrFeed): string {
  if (feed.kind === 'search') return `«${feed.q}»`
  return HUB_PRESETS.find((h) => h.id === feed.id)?.label ?? feed.id
}

/** Ссылка на хаб (`habr.com/ru/hubs/<id>/`) — хаб, всё остальное — поисковый запрос. */
function parseFeedInput(raw: string): HabrFeed | null {
  const value = raw.trim()
  if (!value) return null
  const hub = /habr\.com\/(?:[a-z]{2}\/)?hubs?\/([a-z0-9_-]+)/i.exec(value)
  if (hub) return { kind: 'hub', id: hub[1].toLowerCase() }
  return { kind: 'search', q: value.slice(0, 80) }
}

/**
 * «Ещё»: напоминания бота, темы ленты Хабра и резервные копии. Копия и
 * карточки для Anki приходят файлом в чат с ботом — из вебвью Telegram
 * скачивание работает не везде.
 */
export default function ReadingSettingsPage() {
  const { settings, updateSettings, reloadTexts, reloadState } = useReading()
  const [feedInput, setFeedInput] = useState('')
  const [exporting, setExporting] = useState<'json' | 'anki' | null>(null)
  const [restoring, setRestoring] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const feeds = settings.habrFeeds
  const keys = new Set(feeds.map(feedKey))
  const full = feeds.length >= MAX_HABR_FEEDS

  const setFeeds = (next: HabrFeed[]) =>
    updateSettings({ habrFeeds: next.slice(0, MAX_HABR_FEEDS) })
  const addFeed = (feed: HabrFeed | null) => {
    if (!feed || keys.has(feedKey(feed)) || full) return
    setFeeds([...feeds, feed])
  }

  const exportFile = async (format: 'json' | 'anki') => {
    setExporting(format)
    try {
      const res = await apiFetch('/api/reading/export', {
        method: 'POST',
        body: JSON.stringify({ format }),
      })
      showToast(
        res.ok
          ? { kind: 'success', message: 'Файл отправлен в чат с ботом' }
          : { kind: 'error', message: 'Не удалось отправить файл' },
      )
    } catch {
      showToast({ kind: 'error', message: 'Нет связи с сервером' })
    } finally {
      setExporting(null)
    }
  }

  const restore = async (file: File) => {
    setRestoring(true)
    try {
      let raw: unknown
      try {
        raw = JSON.parse(await file.text())
      } catch {
        showToast({ kind: 'error', message: 'Это не JSON-файл копии' })
        return
      }
      const res = await apiFetch('/api/reading/backup', {
        method: 'POST',
        body: JSON.stringify(raw),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        texts?: number
        sessions?: number
        cards?: number
      }
      if (!res.ok) {
        showToast({ kind: 'error', message: data.error ?? 'Копия не восстановилась' })
        return
      }
      showToast({
        kind: 'success',
        message: `Восстановлено: текстов ${data.texts ?? 0}, тренировок ${data.sessions ?? 0}, карточек ${data.cards ?? 0}`,
      })
      await Promise.all([reloadTexts(), reloadState()])
    } catch {
      showToast({ kind: 'error', message: 'Нет связи с сервером' })
    } finally {
      setRestoring(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <>
      <Panel title="Напоминания в боте">
        <Lede>
          Бот напишет в выбранное время, если сегодня ещё не было тренировки, — с планом на день и
          кнопкой повторить слова прямо в чате.
        </Lede>
        <Toggle
          label="Напоминать о занятии"
          checked={settings.remindEnabled}
          onChange={(remindEnabled) => updateSettings({ remindEnabled })}
        />
        <label className="flex items-center gap-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          Время
          <input
            type="time"
            value={settings.remindTime}
            disabled={!settings.remindEnabled}
            onChange={(e) => e.target.value && updateSettings({ remindTime: e.target.value })}
            className={`${fieldClass} w-28 disabled:opacity-45`}
          />
        </label>
        <Toggle
          label="Беречь серию: напомнить ещё раз в 21:30"
          checked={settings.streakGuard}
          onChange={(streakGuard) => updateSettings({ streakGuard })}
        />
      </Panel>

      <Panel title="Темы Хабра" aside={`${feeds.length} / ${MAX_HABR_FEEDS}`}>
        <Lede>
          Откуда берутся статьи в «Тексты → Хабр». Хаб — раздел сайта, запрос — поиск по свежим
          статьям. Можно вставить ссылку на хаб.
        </Lede>
        {feeds.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {feeds.map((feed) => (
              <li
                key={feedKey(feed)}
                className="flex items-center gap-1 rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] py-1 pr-1 pl-3 text-[13px]"
              >
                {feedTitle(feed)}
                <button
                  type="button"
                  aria-label={`Убрать ${feedTitle(feed)}`}
                  onClick={() => setFeeds(feeds.filter((f) => feedKey(f) !== feedKey(feed)))}
                  className="grid h-6 w-6 place-items-center rounded-full text-[var(--tg-theme-hint-color,#8e8e93)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Lede>Тем нет — лента Хабра будет пустой.</Lede>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {HUB_PRESETS.filter((h) => !keys.has(`hub:${h.id}`)).map((h) => (
            <Chip key={h.id} active={false} onClick={() => addFeed({ kind: 'hub', id: h.id })}>
              + {h.label}
            </Chip>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addFeed(parseFeedInput(feedInput))
            setFeedInput('')
          }}
        >
          <input
            type="text"
            value={feedInput}
            onChange={(e) => setFeedInput(e.target.value)}
            placeholder="Запрос или ссылка на хаб"
            className={fieldClass}
          />
          <Btn type="submit" disabled={full || !feedInput.trim()}>
            Добавить
          </Btn>
        </form>
      </Panel>

      <Panel title="Резервная копия">
        <Lede>
          Тексты, тренировки, карточки и настройки одним файлом — придёт в чат с ботом.
          Восстановление сливает копию с текущими данными, ничего не дублируя.
        </Lede>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={exporting !== null} onClick={() => exportFile('json')}>
            {exporting === 'json' ? 'Отправляю…' : 'Копия в чат'}
          </Btn>
          <Btn disabled={exporting !== null} onClick={() => exportFile('anki')}>
            {exporting === 'anki' ? 'Отправляю…' : 'Карточки для Anki'}
          </Btn>
          <Btn disabled={restoring} onClick={() => fileInput.current?.click()}>
            {restoring ? 'Восстанавливаю…' : 'Восстановить'}
          </Btn>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) restore(file)
          }}
        />
      </Panel>
    </>
  )
}
