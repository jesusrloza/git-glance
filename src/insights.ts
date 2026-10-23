import type { Commit, DateWindow, EmptyWeekday, RepoSummary, WindowGrain } from './types.ts'
import { formatDayFull, formatDayLong, formatMonthLong, monthKey } from './window.ts'

/**
 * Short factual bullets: first/last active day and commit count per repo.
 */
export function buildHandoff(repoSummaries: RepoSummary[], subjectCommits: Commit[], window: DateWindow): string {
  const withActivity = repoSummaries
    .filter((r) => r.commitDays.length > 0)
    .slice()
    .sort((a, b) => {
      const af = a.commitDays[0]!
      const bf = b.commitDays[0]!
      return af < bf ? -1 : af > bf ? 1 : 0
    })

  if (subjectCommits.length === 0 || withActivity.length === 0) {
    return '- No commits from you in this window.'
  }

  if (window.grain === 'month') {
    return withActivity
      .map((r) => {
        const months = [...new Set(r.commitDays.map(monthKey))].sort()
        const first = months[0]!
        const last = months[months.length - 1]!
        const span = first === last ? formatMonthLong(first) : `${formatMonthLong(first)} – ${formatMonthLong(last)}`
        return `- \`${r.repo}\`: **${r.commits}** commits, ${span} (${months.length} month${months.length === 1 ? '' : 's'})`
      })
      .join('\n')
  }

  return withActivity
    .map((r) => {
      const first = r.commitDays[0]!
      const last = r.commitDays[r.commitDays.length - 1]!
      const span = first === last ? formatDayLong(first) : `${formatDayLong(first)} – ${formatDayLong(last)}`
      return `- \`${r.repo}\`: **${r.commits}** commits, ${span} (${r.weekdayCount} weekday${r.weekdayCount === 1 ? '' : 's'})`
    })
    .join('\n')
}

/**
 * Short factual bullets about empty periods (weekdays or months).
 */
export function buildEmptyDayInsight(
  emptyWeekdays: EmptyWeekday[],
  longestStretch: string[],
  gapSlots: string[],
  grain: WindowGrain,
): string {
  const unit = grain === 'month' ? 'month' : 'weekday'
  const units = grain === 'month' ? 'months' : 'weekdays'
  const worked = gapSlots.length - emptyWeekdays.length
  const lines: string[] = [
    `- **${worked}** of **${gapSlots.length}** ${units} have a commit from you; **${emptyWeekdays.length}** are empty.`,
  ]

  if (emptyWeekdays.length === 0) {
    return lines.join('\n')
  }

  const formatPeriod = grain === 'month' ? formatMonthLong : formatDayFull

  if (longestStretch.length === 1) {
    lines.push(`- Longest empty stretch: ${formatPeriod(longestStretch[0]!)} (1 ${unit}).`)
  } else if (longestStretch.length > 1) {
    lines.push(
      `- Longest empty stretch: ${longestStretch.map(formatPeriod).join(' – ')} (${longestStretch.length} ${units}).`,
    )
  }

  return lines.join('\n')
}
