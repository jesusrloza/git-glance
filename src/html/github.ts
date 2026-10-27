import * as d3 from 'd3'
import { ageLabel, commitsForAuthor, data, formatWhen, repoColor, repoLabel, withTip } from './common.ts'
import { isoInWindow } from '../window.ts'
import type { AuthorSummary, PullRequestInfo, WorkflowRunInfo } from './common.ts'
import type { PrReview } from '../types.ts'

type Container = d3.Selection<HTMLElement, unknown, null, undefined>

const num = d3.format(',')

function emptyNote(container: Container, text: string) {
  container.append('p').attr('class', 'hint').text(text)
}

function inWindow(iso: string | null): boolean {
  return isoInWindow(iso, data.window)
}

/** Login from a GitHub noreply address, else null. */
function noreplyLogin(email: string): string | null {
  const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email)
  return m ? m[1]!.toLowerCase() : null
}

/**
 * GitHub logins for a dashboard author (who is keyed by email): logins whose
 * commits used one of the author's emails, noreply addresses, and for the
 * subject the gh login plus `subjectLogins`.
 */
export function loginsFor(author: AuthorSummary): Set<string> {
  const gh = data.github
  const logins = new Set<string>()
  if (!gh) return logins
  const emails = new Set(author.emails.map((e) => e.toLowerCase()))
  if (author.isSubject) for (const l of gh.subjectLogins) logins.add(l)
  for (const email of emails) {
    const l = noreplyLogin(email)
    if (l) logins.add(l)
  }
  for (const [login, list] of Object.entries(gh.loginEmails)) {
    if (list.some((e) => emails.has(e))) logins.add(login)
  }
  // Another dashboard author may claim a login through a shared address; the
  // subject keeps its own logins only.
  if (!author.isSubject) for (const l of gh.subjectLogins) logins.delete(l)
  return logins
}

function pill<E extends HTMLElement>(
  cell: d3.Selection<E, unknown, null, undefined>,
  text: string,
  tone: string,
  tipText?: string,
) {
  const el = cell.append('span').attr('class', `pill ${tone}`).text(text)
  if (tipText) withTip(el, () => tipText)
}

function stateTone(pr: PullRequestInfo): [string, string] {
  if (pr.state === 'MERGED') return ['merged', 'ok']
  if (pr.state === 'CLOSED') return ['closed', 'muted']
  return [pr.isDraft ? 'draft' : 'open', 'wait']
}

function reviewTone(decision: string): [string, string] | null {
  if (decision === 'APPROVED') return ['approved', 'ok']
  if (decision === 'CHANGES_REQUESTED') return ['changes', 'bad']
  if (decision === 'REVIEW_REQUIRED') return ['review needed', 'wait']
  return null
}

export function checksTone(checks: PullRequestInfo['checks']): [string, string] | null {
  if (checks === 'success') return ['checks pass', 'ok']
  if (checks === 'failure') return ['checks fail', 'bad']
  if (checks === 'pending') return ['checks running', 'wait']
  return null
}

export function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

function stateTip(pr: PullRequestInfo): string {
  if (pr.state === 'MERGED' && pr.mergedIso) {
    return `Merged ${formatWhen(pr.mergedIso)} · ${formatDuration(hoursBetween(pr.createdIso, pr.mergedIso))} after opening`
  }
  if (pr.state === 'CLOSED' && pr.closedIso) {
    return `Closed without merging ${formatWhen(pr.closedIso)}\nOpened ${formatWhen(pr.createdIso)}`
  }
  return [
    `Opened ${formatWhen(pr.createdIso)} · ${ageLabel(pr.createdIso)}${pr.isDraft ? ' · draft' : ''}`,
    `Last update ${formatWhen(pr.updatedIso)}`,
    `+${num(pr.additions)} / −${num(pr.deletions)} lines`,
  ].join('\n')
}

/** Each reviewer's most recent approving or blocking review (comments don't change a verdict). */
function latestVerdicts(pr: PullRequestInfo): PrReview[] {
  const latest = new Map<string, PrReview>()
  for (const r of [...pr.reviews].sort((a, b) => (a.iso < b.iso ? -1 : 1))) {
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(r.login, r)
  }
  return [...latest.values()]
}

function reviewTip(pr: PullRequestInfo): string {
  const verdicts = latestVerdicts(pr)
  const line = (state: PrReview['state'], label: string) => {
    const who = verdicts.filter((r) => r.state === state)
    return who.length ? [`${label} by ${who.map((r) => `${r.login} (${formatWhen(r.iso)})`).join(', ')}`] : []
  }
  const lines = [...line('APPROVED', 'Approved'), ...line('CHANGES_REQUESTED', 'Changes requested')]
  if (pr.reviewRequests.length) lines.push(`Waiting on ${pr.reviewRequests.join(', ')}`)
  if (pr.reviewDecision === 'REVIEW_REQUIRED' && !pr.reviewRequests.length) lines.push('No reviewer requested')
  lines.push(`Open ${ageLabel(pr.createdIso).replace(' ago', '')}`)
  return lines.join('\n')
}

function checksTip(pr: PullRequestInfo): string | undefined {
  if (!pr.checksIso) return undefined
  const when = formatWhen(pr.checksIso)
  if (pr.checks === 'success') return `All checks passed · last finished ${when}`
  if (pr.checks === 'failure') return `A check failed · latest activity ${when}`
  return `Checks running · latest activity ${when}`
}

export function repoChip(cell: d3.Selection<HTMLTableCellElement, unknown, null, undefined>, repo: string) {
  cell.append('span').attr('class', 'repo-chip').style('--swatch', repoColor(repo)).text(repoLabel(repo))
}

export function prLink<E extends HTMLElement>(
  cell: d3.Selection<E, unknown, null, undefined>,
  pr: PullRequestInfo,
  withTitle: boolean,
) {
  const a = cell.append('a').attr('href', pr.url).attr('target', '_blank').attr('rel', 'noopener')
  a.text(withTitle ? `#${pr.number} ${pr.title}` : `#${pr.number}`)
  if (!withTitle) a.attr('title', pr.title)
}

/** Status pills for a PR: state, review decision, checks. */
export function prPills<E extends HTMLElement>(cell: d3.Selection<E, unknown, null, undefined>, pr: PullRequestInfo) {
  const [state, tone] = stateTone(pr)
  pill(cell, state, tone, stateTip(pr))
  // reviewDecision stays empty without a required-review rule; pending requests still mean "waiting".
  const review =
    pr.state !== 'OPEN'
      ? null
      : (reviewTone(pr.reviewDecision) ?? (pr.reviewRequests.length ? ['awaiting review', 'wait'] : null))
  if (review) pill(cell, ...review, reviewTip(pr))
  const checks = pr.state === 'OPEN' ? checksTone(pr.checks) : null
  if (checks) pill(cell, ...checks, checksTip(pr))
}

/** Newest PR opened from `branch` in `repo`, if any. */
export function prForBranch(repo: string, branch: string): PullRequestInfo | undefined {
  return data.github?.prs.find((p) => p.repo === repo && p.headRef === branch)
}

/** PR cell for the Work in flight table. */
export function branchPrCell(
  cell: d3.Selection<HTMLTableCellElement, unknown, null, undefined>,
  repo: string,
  branch: string,
) {
  const pr = prForBranch(repo, branch)
  if (!pr) {
    cell.classed('muted', true).text('no PR')
    return
  }
  prLink(cell as unknown as d3.Selection<HTMLElement, unknown, null, undefined>, pr, false)
  cell.append('span').text(' ')
  prPills(cell as unknown as d3.Selection<HTMLElement, unknown, null, undefined>, pr)
}

export function tiles(container: Container, items: { label: string; value: string; note?: string }[]) {
  const wrap = container.append('div').attr('class', 'kpis')
  for (const item of items) {
    const tile = wrap.append('div').attr('class', 'kpi')
    tile.append('div').attr('class', 'label').text(item.label)
    tile.append('div').attr('class', 'value').text(item.value)
    tile
      .append('div')
      .attr('class', 'delta')
      .text(item.note ?? '')
  }
}

// ---------------------------------------------------------------------------
// Pull requests opened by the author

export type PrMode = 'open' | 'all'

/** The author's PRs with activity in the window, split the way the cards count them. */
export function prStats(author: AuthorSummary) {
  const logins = loginsFor(author)
  const prs = (data.github?.prs ?? []).filter((p) => logins.has(p.author))
  const merged = prs.filter((p) => inWindow(p.mergedIso))
  const open = prs.filter((p) => p.state === 'OPEN')
  return {
    prs,
    opened: prs.filter((p) => inWindow(p.createdIso)),
    merged,
    closed: prs.filter((p) => p.state === 'CLOSED' && inWindow(p.closedIso)),
    open,
    drafts: open.filter((p) => p.isDraft).length,
    /** Hours from opened to merged, per merged PR. */
    toMerge: merged.map((p) => hoursBetween(p.createdIso, p.mergedIso!)),
  }
}

/** Median of hours as "5d" / "3h", or an em dash with no samples. */
export function medianDuration(hours: number[]): string {
  return hours.length ? formatDuration(d3.median(hours) ?? 0) : '—'
}

export function drawPullRequests(container: Container, author: AuthorSummary, mode: PrMode = 'all') {
  container.selectAll('*').remove()
  const { prs, opened, merged, closed, open, drafts, toMerge } = prStats(author)
  if (prs.length === 0) return emptyNote(container, 'No pull requests from this author had activity in the window.')

  tiles(container, [
    { label: 'Opened', value: num(opened.length) },
    { label: 'Merged', value: num(merged.length) },
    { label: 'Closed unmerged', value: num(closed.length) },
    { label: 'Open now', value: num(open.length), note: drafts ? `${drafts} draft${drafts === 1 ? '' : 's'}` : '' },
    {
      label: 'Median to merge',
      value: medianDuration(toMerge),
      note: toMerge.length ? `${num(toMerge.length)} merged` : '',
    },
  ])

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Repo', 'Pull request', 'Status', 'Opened'])
    .join('th')
    .text((d) => d)
  const listed = mode === 'open' ? open : prs
  if (listed.length === 0) {
    table.remove()
    return emptyNote(container, 'No open pull requests from this author. Switch to All to see the rest.')
  }
  const tr = table.append('tbody').selectAll('tr').data(listed).join('tr')
  tr.append('td').each(function (d) {
    repoChip(d3.select(this), d.repo)
  })
  tr.append('td').each(function (d) {
    prLink(d3.select(this), d, true)
  })
  tr.append('td').each(function (d) {
    prPills(d3.select(this), d)
  })
  withTip(
    tr
      .append('td')
      .attr('class', 'muted nowrap')
      .text((d) => d.createdIso.slice(0, 10)),
    (d) => `Opened ${formatWhen(d.createdIso)} · ${ageLabel(d.createdIso)}\nLast update ${formatWhen(d.updatedIso)}`,
  )
}

// ---------------------------------------------------------------------------
// Reviews the author gave on other people's PRs

const REVIEW_KINDS = [
  { state: 'APPROVED', label: 'Approved' },
  { state: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { state: 'COMMENTED', label: 'Commented' },
] as const

/** Reviews the author left on other people's PRs in the window, and hours from PR opened to their first review. */
export function reviewStats(author: AuthorSummary) {
  const logins = loginsFor(author)
  const given = (data.github?.prs ?? [])
    .filter((p) => !logins.has(p.author))
    .flatMap((pr) => pr.reviews.filter((r) => logins.has(r.login) && inWindow(r.iso)).map((r) => ({ pr, r })))
  const reviewedPrs = new Set(given.map((g) => `${g.pr.repo}#${g.pr.number}`))
  const firstReview = d3.rollup(
    given,
    (list) => d3.min(list, (g) => g.r.iso)!,
    (g) => `${g.pr.repo}#${g.pr.number}`,
  )
  const turnaround = [...firstReview].map(([key, iso]) => {
    const pr = given.find((g) => `${g.pr.repo}#${g.pr.number}` === key)!.pr
    return hoursBetween(pr.createdIso, iso)
  })
  return { given, reviewedPrs, turnaround }
}

export function drawReviews(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const { given, reviewedPrs, turnaround } = reviewStats(author)
  if (given.length === 0)
    return emptyNote(container, "No reviews from this author on other people's pull requests in the window.")

  tiles(container, [
    { label: 'Reviews', value: num(given.length) },
    { label: 'PRs reviewed', value: num(reviewedPrs.size) },
    ...REVIEW_KINDS.map((k) => ({ label: k.label, value: num(given.filter((g) => g.r.state === k.state).length) })),
    {
      label: 'Median first review',
      value: medianDuration(turnaround),
      note: 'after PR opened',
    },
  ])

  const rows = data.repos
    .map((repo) => ({ repo, list: given.filter((g) => g.pr.repo === repo) }))
    .filter((row) => row.list.length > 0)
  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Repo', 'PRs', ...REVIEW_KINDS.map((k) => k.label), 'Authors reviewed'])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr')
  tr.append('td').each(function (d) {
    repoChip(d3.select(this), d.repo)
  })
  tr.append('td').text((d) => num(new Set(d.list.map((g) => g.pr.number)).size))
  for (const k of REVIEW_KINDS) {
    tr.append('td').text((d) => num(d.list.filter((g) => g.r.state === k.state).length))
  }
  tr.append('td')
    .classed('muted', true)
    .text((d) => [...new Set(d.list.map((g) => g.pr.author))].join(', '))
}

// ---------------------------------------------------------------------------
// CI runs on the author's work

/** Runs that built one of the author's commits, or ran on the head branch of one of their PRs. */
function runsForAuthor(author: AuthorSummary): WorkflowRunInfo[] {
  const hashes = new Set(commitsForAuthor(author).map((c) => c.hash))
  const logins = loginsFor(author)
  const branches = new Set(
    (data.github?.prs ?? []).filter((p) => logins.has(p.author)).map((p) => `${p.repo}\t${p.headRef}`),
  )
  return (data.github?.runs ?? []).filter((r) => hashes.has(r.headSha) || branches.has(`${r.repo}\t${r.headBranch}`))
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required'])

/** Runs that count toward a pass rate (cancelled and skipped runs don't), and the failed ones among them. */
function passRate(list: WorkflowRunInfo[]) {
  const finished = list.filter(
    (r) => r.status === 'completed' && r.conclusion !== 'skipped' && r.conclusion !== 'cancelled',
  )
  const failed = finished.filter((r) => FAILED.has(r.conclusion))
  return { finished, failed }
}

/** CI runs on the author's work across all repos; `pct` is null when none finished. */
export function ciStats(author: AuthorSummary) {
  const runs = runsForAuthor(author)
  const { finished, failed } = passRate(runs)
  const pct = finished.length ? Math.round(((finished.length - failed.length) / finished.length) * 100) : null
  return { runs, finished, failed, pct }
}

export function drawCi(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const runs = runsForAuthor(author)
  if (runs.length === 0)
    return emptyNote(container, "No workflow runs on this author's commits or PR branches in the window.")

  const rows = data.repos
    .map((repo) => {
      const list = runs.filter((r) => r.repo === repo)
      return { repo, list, ...passRate(list) }
    })
    .filter((row) => row.list.length > 0)

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Repo', 'Runs', 'Failed', 'Pass rate'])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr')
  tr.append('td').each(function (d) {
    repoChip(d3.select(this), d.repo)
  })
  tr.append('td').text((d) => num(d.list.length))
  tr.append('td')
    .text((d) => num(d.failed.length))
    .classed('muted', (d) => d.failed.length === 0)
  tr.append('td').each(function (d) {
    const cell = d3.select(this)
    if (d.finished.length === 0) {
      cell.classed('muted', true).text('—')
      return
    }
    const pct = Math.round(((d.finished.length - d.failed.length) / d.finished.length) * 100)
    const meter = cell.append('div').attr('class', 'meter')
    meter
      .append('div')
      .attr('class', 'meter-track')
      .append('div')
      .attr('class', 'meter-fill')
      .style('width', `${pct}%`)
      .style('background', pct >= 80 ? 'var(--accent)' : 'var(--type-fix)')
    meter.append('span').text(`${pct}%`)
  })

  const failures = runs.filter((r) => FAILED.has(r.conclusion)).slice(0, 5)
  if (failures.length === 0) return
  container.append('p').attr('class', 'hint').text('Latest failures')
  const list = container.append('ul').attr('class', 'run-failures')
  const li = list.selectAll('li').data(failures).join('li')
  li.append('span')
    .attr('class', 'repo-chip')
    .style('--swatch', (d) => repoColor(d.repo))
    .text((d) => repoLabel(d.repo))
  li.append('span').text(' ')
  li.append('a')
    .attr('href', (d) => d.url)
    .attr('target', '_blank')
    .attr('rel', 'noopener')
    .text((d) => `${d.workflow} on ${d.headBranch}`)
  li.append('span')
    .attr('class', 'muted')
    .text((d) => ` · ${d.iso.slice(0, 10)}`)
}
