'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/telegram/webapp'

export default function SettingsPage() {
  const [timezone, setTimezone] = useState('Europe/Moscow')
  const [morningTime, setMorningTime] = useState('08:00')
  const [eveningTime, setEveningTime] = useState('21:00')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    // Автоопределение timezone
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected) setTimezone(detected)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ timezone, morningDigestTime: morningTime, eveningDigestTime: eveningTime }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Header title="⚙️ Настройки" />
      <div className="px-4 py-2 space-y-4">
        <div className="rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] dark:bg-[var(--tg-theme-section-bg-color,#1c1c1e)] p-4 space-y-4">
          {/* Timezone */}
          <div>
            <label className="text-xs font-medium text-[var(--tg-theme-hint-color,#9ca3af)]">
              Часовой пояс
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm outline-none"
            >
              <option value="Europe/Moscow">Москва (UTC+3)</option>
              <option value="Europe/Kaliningrad">Калининград (UTC+2)</option>
              <option value="Europe/Samara">Самара (UTC+4)</option>
              <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option>
              <option value="Asia/Novosibirsk">Новосибирск (UTC+7)</option>
              <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
              <option value="Europe/Kiev">Киев (UTC+2)</option>
              <option value="Asia/Almaty">Алматы (UTC+6)</option>
              <option value="Asia/Tashkent">Ташкент (UTC+5)</option>
            </select>
          </div>

          {/* Утренний дайджест */}
          <div>
            <label className="text-xs font-medium text-[var(--tg-theme-hint-color,#9ca3af)]">
              Утренний дайджест
            </label>
            <input
              type="time"
              value={morningTime}
              onChange={(e) => setMorningTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>

          {/* Вечерний итог */}
          <div>
            <label className="text-xs font-medium text-[var(--tg-theme-hint-color,#9ca3af)]">
              Вечерний итог
            </label>
            <input
              type="time"
              value={eveningTime}
              onChange={(e) => setEveningTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение...' : saved ? '✅ Сохранено' : 'Сохранить'}
        </Button>
      </div>
    </>
  )
}
