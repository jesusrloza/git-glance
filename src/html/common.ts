import * as d3 from 'd3'
import type { AuthorSummary, BranchInfo, Commit, DayMark, GithubData, TagInfo } from '../types.ts'

export type {
  AuthorSummary,
  BranchInfo,
  Commit,
  DayMark,
  GithubData,
  PullRequestInfo,
  TagInfo,
  WorkflowRunInfo,
} from '../types.ts'

export type ReportPayload = {
  days: string[]
  weekdays: string[]
  grain: 'day' | 'month'
  repos: string[]
  repoLabels: Record<string, string>
  subjectEmails: string[]
  workspaceMarks: Record<string, DayMark>
  repoMarks: Record<string, Record<string, DayMark>>
  allCommits: Commit[]
  subjectCommits: Commit[]
  authors: AuthorSummary[]
  emptyWeekdays: { day: string; weekday: string }[]
  window: { start: string; end: string; label: string; grain: 'day' | 'month' }
  previousWindow: { start: string; end: string; label: string; grain: 'day' | 'month' } | null
  previousCommits: Commit[]
  branches: BranchInfo[]
  tags: TagInfo[]
  /** Null when GitHub data is off or gh is unavailable. */
  github: GithubData | null
}

declare global {
  interface Window {
    __REPORT__: ReportPayload
  }
}

export const data = window.__REPORT__
export const grain = data.grain ?? data.window.grain ?? 'day'

export function repoLabel(repo: string): string {
  return data.repoLabels?.[repo] ?? repo
}

export function repoColor(repo: string): string {
  const i = data.repos.indexOf(repo)
  if (i >= 0) return `var(--repo-${i})`
  return 'var(--repo-0)'
}

/** Map a commit calendar day to a period key (YYYY-MM-DD or YYYY-MM). */
export function periodOf(day: string): string {
  return grain === 'month' ? day.slice(0, 7) : day
}

export function commitsInPeriod(commits: Commit[], period: string, repo?: string): Commit[] {
  return commits.filter((c) => periodOf(c.day) === period && (repo === undefined || c.repo === repo))
}

export function periodAxisLabel(period: string): string {
  if (grain === 'month') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const m = /^(\d{4})-(\d{2})$/.exec(period)
    if (!m) return period
    return `${months[Number(m[2]) - 1]} ${m[1]!.slice(2)}`
  }
  return String(Number(period.slice(8, 10)))
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Pick dark or light ink from the cell fill’s perceived brightness. */
export function inkOn(bg: string): string {
  const c = d3.rgb(bg)
  if (Number.isNaN(c.r)) return 'var(--ink)'
  const yiq = (c.r * 299 + c.g * 587 + c.b * 114) / 1000
  return yiq >= 140 ? 'var(--heatmap-ink-dark)' : 'var(--ink)'
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function commitsForAuthor(author: AuthorSummary): Commit[] {
  if (author.isSubject) return data.subjectCommits
  const emails = new Set(author.emails.map((e) => e.toLowerCase()))
  return data.allCommits.filter((c) => emails.has(c.authorEmail.toLowerCase()))
}

export function marksFor(commits: Commit[]): {
  workspace: Record<string, DayMark>
  repos: Record<string, Record<string, DayMark>>
} {
  const periodsWith = new Set(commits.map((c) => periodOf(c.day)))
  const workspace: Record<string, DayMark> = {}
  for (const day of data.days) {
    workspace[day] = periodsWith.has(day) ? 'committed' : 'empty'
  }
  const repos: Record<string, Record<string, DayMark>> = {}
  for (const repo of data.repos) {
    const repoPeriods = new Set(commits.filter((c) => c.repo === repo).map((c) => periodOf(c.day)))
    repos[repo] = {}
    for (const day of data.days) {
      repos[repo]![day] = repoPeriods.has(day) ? 'committed' : 'empty'
    }
  }
  return { workspace, repos }
}

export function shortHash(h: string): string {
  return h.slice(0, 7)
}

export function hourFromIso(iso: string): number {
  const m = /T(\d{2}):/.exec(iso)
  return m ? Number(m[1]) : 0
}

export function formatTooltip(period: string, commits: Commit[]): string {
  const label = grain === 'month' ? periodAxisLabel(period) : period
  if (commits.length === 0) return `${label}: no commits`
  return [
    `${label} — ${commits.length} commit${commits.length === 1 ? '' : 's'}`,
    ...commits.map((c) => `• ${c.iso.slice(11, 16)} ${repoLabel(c.repo)} ${shortHash(c.hash)} ${c.subject}`),
  ].join('\n')
}

export function tip(): d3.Selection<d3.BaseType, unknown, HTMLElement, unknown> {
  return d3.select('#tooltip')
}

export function showTip(event: MouseEvent, text: string) {
  tip()
    .style('opacity', 1)
    .style('left', `${event.clientX + 12}px`)
    .style('top', `${event.clientY + 12}px`)
    .text(text)
}

export function hideTip() {
  tip().style('opacity', 0)
}

export function styleAxis(ax: d3.Selection<SVGGElement, unknown, null, undefined>) {
  ax.selectAll('text').attr('font-size', 11).attr('fill', 'var(--muted)')
  ax.selectAll('line, path').attr('stroke', 'var(--axis-stroke)')
}

export function fillRepoLegend(
  container:
    | d3.Selection<d3.BaseType, unknown, HTMLElement, unknown>
    | d3.Selection<HTMLElement, unknown, null, undefined>,
) {
  container.selectAll('*').remove()
  for (const repo of data.repos) {
    container.append('span').style('--swatch', repoColor(repo)).text(repoLabel(repo))
  }
}

export function animateOpacity(el: d3.Selection<SVGElement, unknown, null, undefined>, delay: number, opacity: number) {
  if (prefersReducedMotion()) {
    el.attr('opacity', opacity)
    return
  }
  el.attr('opacity', 0).transition().delay(delay).duration(220).attr('opacity', opacity)
}
