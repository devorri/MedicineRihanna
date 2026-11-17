import type { Schedule } from '../types'

// The ESP32 runs on Philippine time (UTC+8), so the web does all schedule math in Manila time
// regardless of the browser's timezone.
export const TZ = 'Asia/Manila'
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type ManilaNow = { date: string; wday: number; minutes: number }

export function manilaNow(d: Date = new Date()): ManilaNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    wday: DAY_LABELS.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

export function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function formatTime12(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export function minutesTo12(min: number) {
  return formatTime12(`${Math.floor(min / 60)}:${min % 60}`)
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatClock(d: Date) {
  return d.toLocaleString('en-PH', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Midnight (Manila) of a YYYY-MM-DD date, as a UTC Date. */
export function manilaDayStart(date: string) {
  return new Date(`${date}T00:00:00+08:00`)
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00+08:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return manilaNow(d).date
}

export function dayLabel(offset: number, date: string) {
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Tomorrow'
  return new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en-PH', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function describeDays(days: number[]) {
  const s = [...days].sort()
  if (s.length === 7) return 'Every day'
  if (s.join() === '1,2,3,4,5') return 'Weekdays'
  if (s.join() === '0,6') return 'Weekends'
  return s.map((d) => DAY_LABELS[d]).join(', ')
}

export type UpcomingDose = { schedule: Schedule; offset: number; date: string; minutes: number }

/** Mirrors the ESP32 logic: fires when HH:MM matches, the weekday matches, and it hasn't fired today. */
export function upcomingDoses(schedules: Schedule[], limit = 20, horizonDays = 7): UpcomingDose[] {
  const now = manilaNow()
  const out: UpcomingDose[] = []
  for (let off = 0; off <= horizonDays; off++) {
    const date = addDays(now.date, off)
    const wday = (now.wday + off) % 7
    for (const s of schedules) {
      if (!s.is_active || !s.days_of_week.includes(wday)) continue
      const min = timeToMinutes(s.schedule_time)
      if (off === 0 && (min < now.minutes || s.last_triggered_date === now.date)) continue
      out.push({ schedule: s, offset: off, date, minutes: min })
    }
  }
  out.sort((a, b) => a.offset - b.offset || a.minutes - b.minutes)
  return out.slice(0, limit)
}

/** Active schedules for today whose minute has passed without the ESP32 marking them triggered. */
export function missedToday(schedules: Schedule[]) {
  const now = manilaNow()
  return schedules.filter(
    (s) =>
      s.is_active &&
      s.days_of_week.includes(now.wday) &&
      timeToMinutes(s.schedule_time) < now.minutes - 3 && // ESP32 has a 2-minute catch-up window
      s.last_triggered_date !== now.date,
  )
}

export function countdown(d: UpcomingDose) {
  const diff = d.offset * 1440 + d.minutes - manilaNow().minutes
  if (diff <= 0) return 'now'
  const h = Math.floor(diff / 60)
  const m = diff % 60
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `in ${h}h ${m}m` : `in ${m}m`
}
