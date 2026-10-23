import type {
  AuthorSummary,
  BranchInfo,
  Commit,
  DateWindow,
  DayMark,
  EmptyWeekday,
  GithubData,
  ReportConfig,
  ReportData,
  RepoSummary,
  TagInfo,
  WeekendCommitDay,
} from './types.ts'
import { eachDay, eachMonth, isWeekend, monthKey, todayLocal, weekdayName } from './window.ts'
import { buildEmptyDayInsight, buildHandoff } from './insights.ts'

export function isSubjectEmail(email: string, subjectEmails: string[]): boolean {
  const lower = email.toLowerCase()
  return subjectEmails.some((e) => e.toLowerCase() === lower)
}

function marksFor(periods: string[], active: Set<string>): Record<string, DayMark> {
  const out: Record<string, DayMark> = {}
  for (const p of periods) {
    out[p] = active.has(p) ? 'committed' : 'empty'
  }
  return out
}

function longestWeekdayStretch(days: string[]): string[] {
  if (days.length === 0) return []
  let best: string[] = [days[0]!]
  let cur: string[] = [days[0]!]
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1]!
    const day = days[i]!
    const prevDate = new Date(`${prev}T12:00:00Z`)
    const dayDate = new Date(`${day}T12:00:00Z`)
    const diffDays = (dayDate.getTime() - prevDate.getTime()) / (24 * 60 * 60 * 1000)
    const adjacent = diffDays === 1 || diffDays === 3
    if (adjacent) {
      cur.push(day)
    } else {
      if (cur.length > best.length) best = cur
      cur = [day]
    }
  }
  if (cur.length > best.length) best = cur
  return best
}

function longestMonthStretch(months: string[]): string[] {
  if (months.length === 0) return []
  let best: string[] = [months[0]!]
  let cur: string[] = [months[0]!]
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1]!
    const ym = months[i]!
    const [py, pm] = prev.split('-').map(Number) as [number, number]
    const [cy, cm] = ym.split('-').map(Number) as [number, number]
    const adjacent = (cy === py && cm === pm + 1) || (cy === py + 1 && pm === 12 && cm === 1)
    if (adjacent) {
      cur.push(ym)
    } else {
      if (cur.length > best.length) best = cur
      cur = [ym]
    }
  }
  if (cur.length > best.length) best = cur
  return best
}

function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

function periodOf(commitDay: string, grain: DateWindow['grain']): string {
  return grain === 'month' ? monthKey(commitDay) : commitDay
}

/** Extra git context loaded next to the window's commits. */
export type AggregateExtras = {
  previousWindow?: DateWindow | null
  previousCommits?: Commit[]
  branches?: BranchInfo[]
  tags?: TagInfo[]
  github?: GithubData | null
  githubNote?: string | null
}

export function aggregate(
  allCommits: Commit[],
  config: ReportConfig,
  window: DateWindow,
  extras: AggregateExtras = {},
): ReportData {
  const grain = window.grain
  const periods = grain === 'month' ? eachMonth(window.start, window.end) : eachDay(window.start, window.end)
  const gapSlots = grain === 'month' ? periods : periods.filter((d) => !isWeekend(d))

  const subjectEmails = config.subjectEmails.map((e) => e.toLowerCase())
  const subjectCommits = allCommits.filter((c) => isSubjectEmail(c.authorEmail, subjectEmails))

  const subjectPeriods = new Set(subjectCommits.map((c) => periodOf(c.day, grain)))
  const workspaceMarks = marksFor(periods, subjectPeriods)

  const repoNames = config.repos.map((r) => r.name)
  const repoMarks: Record<string, Record<string, DayMark>> = {}
  for (const name of repoNames) {
    const repoPeriods = new Set(subjectCommits.filter((c) => c.repo === name).map((c) => periodOf(c.day, grain)))
    repoMarks[name] = marksFor(periods, repoPeriods)
  }

  const emptyWeekdays: EmptyWeekday[] = []
  for (const slot of gapSlots) {
    if (subjectPeriods.has(slot)) continue
    emptyWeekdays.push({
      day: slot,
      weekday: grain === 'day' ? weekdayName(slot) : '',
    })
  }

  const longestEmptyStretch =
    grain === 'month'
      ? longestMonthStretch(emptyWeekdays.map((e) => e.day))
      : longestWeekdayStretch(emptyWeekdays.map((e) => e.day))

  const weekendCommitDays: WeekendCommitDay[] = []
  if (grain === 'day') {
    const weekendDaysWithCommits = [...new Set(subjectCommits.filter((c) => isWeekend(c.day)).map((c) => c.day))].sort()
    for (const day of weekendDaysWithCommits) {
      weekendCommitDays.push({
        day,
        weekday: weekdayName(day),
        commits: subjectCommits.filter((c) => c.day === day).sort((a, b) => (a.iso < b.iso ? -1 : 1)),
      })
    }
  }

  const repoSummaries: RepoSummary[] = repoNames.map((name) => {
    const commits = subjectCommits.filter((c) => c.repo === name)
    const commitDays = [...new Set(commits.map((c) => c.day))].sort()
    const weekdayDays = commitDays.filter((d) => !isWeekend(d))
    const weekendDays = commitDays.filter((d) => isWeekend(d))
    const lastCommitDay = commitDays.length > 0 ? commitDays[commitDays.length - 1]! : null

    const quietWhileActive: string[] = []
    for (const slot of gapSlots) {
      const activeElsewhere = subjectPeriods.has(slot) && !commits.some((c) => periodOf(c.day, grain) === slot)
      if (activeElsewhere) quietWhileActive.push(slot)
    }

    return {
      repo: name,
      commits: commits.length,
      commitDays,
      weekdayCount: grain === 'month' ? [...new Set(commits.map((c) => monthKey(c.day)))].length : weekdayDays.length,
      weekendDays: grain === 'month' ? [] : weekendDays,
      lastCommitDay,
      quietWhileActive,
    }
  })

  repoSummaries.sort((a, b) => b.commits - a.commits)

  const byEmail = new Map<string, { name: string; email: string; commits: Commit[] }>()
  for (const c of allCommits) {
    let row = byEmail.get(c.authorEmail)
    if (!row) {
      row = { name: c.authorName, email: c.authorEmail, commits: [] }
      byEmail.set(c.authorEmail, row)
    }
    row.commits.push(c)
    row.name = c.authorName
  }

  const otherAuthors: AuthorSummary[] = [...byEmail.values()]
    .filter((a) => !isSubjectEmail(a.email, subjectEmails))
    .map((a) => ({
      name: a.name,
      emails: [a.email],
      commits: a.commits.length,
      activeDays: [...new Set(a.commits.map((c) => c.day))].sort(),
      repos: [...new Set(a.commits.map((c) => c.repo))].sort(),
      isSubject: false,
    }))
    .sort((a, b) => b.commits - a.commits)

  const subjectAuthor: AuthorSummary = {
    name: 'You',
    emails: subjectEmails,
    commits: subjectCommits.length,
    activeDays: [...new Set(subjectCommits.map((c) => c.day))].sort(),
    repos: [...new Set(subjectCommits.map((c) => c.repo))].sort((a, b) => {
      return repoNames.indexOf(a) - repoNames.indexOf(b)
    }),
    isSubject: true,
  }

  if (subjectCommits.length > 0) {
    subjectAuthor.name = subjectCommits[subjectCommits.length - 1]!.authorName
  }

  const authors = [subjectAuthor, ...otherAuthors].sort((a, b) => b.commits - a.commits)

  const handoff = buildHandoff(repoSummaries, subjectCommits, window)
  const emptyDayInsight = buildEmptyDayInsight(emptyWeekdays, longestEmptyStretch, gapSlots, grain)

  const repoLabels: Record<string, string> = {}
  for (const r of config.repos) {
    repoLabels[r.name] = r.label
  }

  return {
    generatedOn: todayLocal(),
    window,
    grain,
    subjectEmails,
    repos: repoNames,
    repoLabels,
    days: periods,
    weekdays: gapSlots,
    subjectCommits,
    allCommits,
    workspaceMarks,
    repoMarks,
    emptyWeekdays,
    longestEmptyStretch,
    weekendCommitDays,
    repoSummaries,
    authors,
    handoff,
    emptyDayInsight,
    previousWindow: extras.previousWindow ?? null,
    previousCommits: extras.previousCommits ?? [],
    branches: extras.branches ?? [],
    tags: extras.tags ?? [],
    github: extras.github ?? null,
    githubNote: extras.githubNote ?? null,
  }
}

export { shortHash }
