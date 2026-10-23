import type { DateWindow } from './types.ts'

/** Parse YYYY-MM-DD as a UTC noon date (avoids DST edge shifts). */
export function parseDay(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) throw new Error(`Invalid day: ${day}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}

export function formatDay(d: Date): string {
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day)
  d.setUTCDate(d.getUTCDate() + n)
  return formatDay(d)
}

/** Local calendar day (YYYY-MM-DD) of a moment in time. */
export function localDay(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

export function todayLocal(): string {
  return localDay(new Date())
}

/**
 * Whether a UTC timestamp (as GitHub reports them) falls on a local day inside
 * the window. Windows are local days, so the UTC date prefix would push an
 * evening event into the next day.
 */
export function isoInWindow(iso: string | null, window: DateWindow): boolean {
  if (!iso) return false
  const day = localDay(new Date(iso))
  return day <= window.end && (window.label === 'all-time' || day >= window.start)
}

/** 0 = Sunday … 6 = Saturday, from YYYY-MM-DD. */
export function weekdayIndex(day: string): number {
  return parseDay(day).getUTCDay()
}

export function isWeekend(day: string): boolean {
  const i = weekdayIndex(day)
  return i === 0 || i === 6
}

export function weekdayName(day: string): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return names[weekdayIndex(day)]!
}

export function eachDay(start: string, end: string): string[] {
  if (start > end) throw new Error(`Window start ${start} is after end ${end}`)
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

/** YYYY-MM from a YYYY-MM-DD day. */
export function monthKey(day: string): string {
  if (/^\d{4}-\d{2}$/.test(day)) return day
  const m = /^(\d{4}-\d{2})-\d{2}$/.exec(day)
  if (!m) throw new Error(`Invalid day or month: ${day}`)
  return m[1]!
}

/** First day of the calendar month containing `day`. */
export function monthStart(day: string): string {
  return `${monthKey(day)}-01`
}

export function addMonths(ym: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) throw new Error(`Invalid month: ${ym}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1, 12))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Inclusive list of YYYY-MM from start day through end day. */
export function eachMonth(startDay: string, endDay: string): string[] {
  const start = monthKey(startDay)
  const end = monthKey(endDay)
  if (start > end) throw new Error(`Window start ${start} is after end ${end}`)
  const months: string[] = []
  for (let ym = start; ym <= end; ym = addMonths(ym, 1)) months.push(ym)
  return months
}

export function lastNDays(n: number, end: string = todayLocal()): DateWindow {
  const start = addDays(end, -(n - 1))
  return { start, end, label: `last-${n}d`, grain: 'day' }
}

export function calendarMonth(ym: string): DateWindow {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) throw new Error(`Invalid --month value: ${ym} (want YYYY-MM)`)
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${ym}`)
  const start = `${m[1]}-${m[2]}-01`
  const endDate = new Date(Date.UTC(year, month, 0, 12)) // last day of month
  const end = formatDay(endDate)
  return { start, end, label: ym, grain: 'day' }
}

export function lastMonth(from: string = todayLocal()): DateWindow {
  const d = parseDay(from)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() // 0-based; previous month is month-1
  const prev = month === 0 ? { y: year - 1, m: 12 } : { y: year, m: month }
  const ym = `${prev.y}-${String(prev.m).padStart(2, '0')}`
  return calendarMonth(ym)
}

/** Day-grain custom range for tests. */
export function customRange(start: string, end: string): DateWindow {
  parseDay(start)
  parseDay(end)
  return { start, end, label: `${start}_to_${end}`, grain: 'day' }
}

/** All-time window from earliest commit day through today (month grain). */
export function allTimeWindow(earliestDay: string, end: string = todayLocal()): DateWindow {
  parseDay(earliestDay)
  parseDay(end)
  return {
    start: monthStart(earliestDay),
    end,
    label: 'all-time',
    grain: 'month',
  }
}

/**
 * Comparison window just before `w`: the previous calendar month for a month
 * window, otherwise the same number of days ending the day before `w.start`.
 * Null for all-time (nothing earlier to compare with).
 */
export function previousWindow(w: DateWindow): DateWindow | null {
  if (w.label === 'all-time') return null
  if (/^\d{4}-\d{2}$/.test(w.label)) return calendarMonth(addMonths(w.label, -1))
  const days = eachDay(w.start, w.end).length
  return customRange(addDays(w.start, -days), addDays(w.start, -1))
}

/** Format a day for prose: "1 September", "5 October". */
export function formatDayLong(day: string): string {
  const d = parseDay(day)
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

/** "1 September 2026" */
export function formatDayFull(day: string): string {
  const d = parseDay(day)
  return `${formatDayLong(day)} ${d.getUTCFullYear()}`
}

/** Short axis label: "1 Sep", "2", "1 Oct" */
export function formatDayShort(day: string, opts: { forceMonth?: boolean } = {}): string {
  const d = parseDay(day)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const date = d.getUTCDate()
  if (opts.forceMonth || date === 1) {
    return `${date} ${months[d.getUTCMonth()]}`
  }
  return String(date)
}

/** Axis / prose label for YYYY-MM: "Sep 2024". */
export function formatMonthShort(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) throw new Error(`Invalid month: ${ym}`)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m[2]) - 1]} ${m[1]}`
}

/** Prose for YYYY-MM: "September 2024". */
export function formatMonthLong(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) throw new Error(`Invalid month: ${ym}`)
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${months[Number(m[2]) - 1]} ${m[1]}`
}
