'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'

const timezones = [
  'Europe/Moscow',
  'Europe/Kiev',
  'Europe/Minsk',
  'Europe/Kaliningrad',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Vladivostok',
  'Asia/Kamchatka',
  'Asia/Almaty',
  'Asia/Tashkent',
  'UTC',
]

export default function SettingsPage() {
  const [timezone, setTimezone] = useState('Europe/Moscow')
  const [morningTime, setMorningTime] = useState('08:00')
  const [eveningTime, setEveningTime] = useState('21:00')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected) setTimezone(detected)

    apiFetch('/api/settings').then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        if (data.timezone) setTimezone(data.timezone)
        if (data.morningDigestTime) setMorningTime(data.morningDigestTime)
        if (data.eveningDigestTime) setEveningTime(data.eveningDigestTime)
      }
    })
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          timezone,
          morningDigestTime: morningTime,
          eveningDigestTime: eveningTime,
        }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }, [timezone, morningTime, eveningTime])

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      <header className="px-4 pt-4 pb-2">
        <h1 className="text-2xl font-bold text-[var(--tg-theme-text-color,#000)]">
          {'⚙️ Настройки'}
        </h1>
      </header>

      <div className="px-4 pb-24 flex flex-col gap-3">
        {/* Часовой пояс */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <label className="block text-sm font-medium text-[var(--tg-theme-text-color,#000)] mb-2">
            Часовой пояс
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none appearance-none cursor-pointer"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Утренний дайджест */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <label className="block text-sm font-medium text-[var(--tg-theme-text-color,#000)] mb-1">
            Утренний дайджест
          </label>
          <p className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] mb-2">
            Время отправки утренней сводки задач
          </p>
          <input
            type="time"
            value={morningTime}
            onChange={(e) => setMorningTime(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none"
          />
        </div>

        {/* Вечерний итог */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <label className="block text-sm font-medium text-[var(--tg-theme-text-color,#000)] mb-1">
            Вечерний итог
          </label>
          <p className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] mb-2">
            Время отправки вечерней сводки
          </p>
          <input
            type="time"
            value={eveningTime}
            onChange={(e) => setEveningTime(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none"
          />
        </div>

        {/* Ссылка на архив */}
        <Link
          href="/archive"
          className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex items-center justify-between active:scale-[0.98] transition-transform"
        >
          <span className="text-sm font-medium text-[var(--tg-theme-text-color,#000)]">
            {'📦 Архив задач'}
          </span>
          <span className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">{'→'}</span>
        </Link>

        {/* Кнопка сохранения */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-all ${
            saved
              ? 'bg-green-500 text-white'
              : 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
          } disabled:opacity-60`}
        >
          {saved ? (
            <>
              <Check className="h-5 w-5" />
              Сохранено
            </>
          ) : saving ? (
            'Сохранение...'
          ) : (
            'Сохранить'
          )}
        </button>
      </div>
    </div>
  )
}
