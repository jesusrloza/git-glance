import * as d3 from 'd3'
import { commitsForAuthor, data, repoColor, repoLabel } from './common.ts'
import { isoInWindow } from '../window.ts'
import type { AuthorSummary, PullRequestInfo, WorkflowRunInfo } from './common.ts'

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

function pill(cell: d3.Selection<HTMLElement, unknown, null, undefined>, text: string, tone: string) {
  cell.append('span').attr('class', `pill ${tone}`).text(text)
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

function checksTone(checks: PullRequestInfo['checks']): [string, string] | null {
  if (checks === 'success') return ['checks pass', 'ok']
  if (checks === 'failure') return ['checks fail', 'bad']
  if (checks === 'pending') return ['checks running', 'wait']
  return null
}

function repoChip(cell: d3.Selection<HTMLTableCellElement, unknown, null, undefined>, repo: string) {
  cell.append('span').attr('class', 'repo-chip').style('--swatch', repoColor(repo)).text(repoLabel(repo))
}

function prLink(cell: d3.Selection<HTMLElement, unknown, null, undefined>, pr: PullRequestInfo, withTitle: boolean) {
  const a = cell.append('a').attr('href', pr.url).attr('target', '_blank').attr('rel', 'noopener')
  a.text(withTitle ? `#${pr.number} ${pr.title}` : `#${pr.number}`)
  if (!withTitle) a.attr('title', pr.title)
}

/** Status pills for a PR: state, review decision, checks. */
function prPills(cell: d3.Selection<HTMLElement, unknown, null, undefined>, pr: PullRequestInfo) {
  const [state, tone] = stateTone(pr)
  pill(cell, state, tone)
  const review = pr.state === 'OPEN' ? reviewTone(pr.reviewDecision) : null
  if (review) pill(cell, ...review)
  const checks = pr.state === 'OPEN' ? checksTone(pr.checks) : null
  if (checks) pill(cell, ...checks)
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

function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

function tiles(container: Container, items: { label: string; value: string; note?: string }[]) {
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

export function drawPullRequests(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const logins = loginsFor(author)
  const prs = (data.github?.prs ?? []).filter((p) => logins.has(p.author))
  if (prs.length === 0) return emptyNote(container, 'No pull requests from this author had activity in the window.')

  const opened = prs.filter((p) => inWindow(p.createdIso))
  const merged = prs.filter((p) => inWindow(p.mergedIso))
  const closed = prs.filter((p) => p.state === 'CLOSED' && inWindow(p.closedIso))
  const open = prs.filter((p) => p.state === 'OPEN')
  const drafts = open.filter((p) => p.isDraft).length
  const toMerge = merged.map((p) => hoursBetween(p.createdIso, p.mergedIso!))
  tiles(container, [
    { label: 'Opened', value: num(opened.length) },
    { label: 'Merged', value: num(merged.length) },
    { label: 'Closed unmerged', value: num(closed.length) },
    { label: 'Open now', value: num(open.length), note: drafts ? `${drafts} draft${drafts === 1 ? '' : 's'}` : '' },
    {
      label: 'Median to merge',
      value: toMerge.length ? formatDuration(d3.median(toMerge) ?? 0) : '—',
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
  const tr = table.append('tbody').selectAll('tr').data(prs).join('tr')
  tr.append('td').each(function (d) {
    repoChip(d3.select(this), d.repo)
  })
  tr.append('td').each(function (d) {
    prLink(d3.select(this), d, true)
  })
  tr.append('td').each(function (d) {
    prPills(d3.select(this), d)
  })
  tr.append('td')
    .attr('class', 'muted nowrap')
    .text((d) => d.createdIso.slice(0, 10))
}

// ---------------------------------------------------------------------------
// Reviews the author gave on other people's PRs

const REVIEW_KINDS = [
  { state: 'APPROVED', label: 'Approved' },
  { state: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { state: 'COMMENTED', label: 'Commented' },
] as const

export function drawReviews(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const logins = loginsFor(author)
  const given = (data.github?.prs ?? [])
    .filter((p) => !logins.has(p.author))
    .flatMap((pr) => pr.reviews.filter((r) => logins.has(r.login) && inWindow(r.iso)).map((r) => ({ pr, r })))
  if (given.length === 0)
    return emptyNote(container, "No reviews from this author on other people's pull requests in the window.")

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
  tiles(container, [
    { label: 'Reviews', value: num(given.length) },
    { label: 'PRs reviewed', value: num(reviewedPrs.size) },
    ...REVIEW_KINDS.map((k) => ({ label: k.label, value: num(given.filter((g) => g.r.state === k.state).length) })),
    {
      label: 'Median first review',
      value: turnaround.length ? formatDuration(d3.median(turnaround) ?? 0) : '—',
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

export function drawCi(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const runs = runsForAuthor(author)
  if (runs.length === 0)
    return emptyNote(container, "No workflow runs on this author's commits or PR branches in the window.")

  const rows = data.repos
    .map((repo) => {
      const list = runs.filter((r) => r.repo === repo)
      const finished = list.filter(
        (r) => r.status === 'completed' && r.conclusion !== 'skipped' && r.conclusion !== 'cancelled',
      )
      const failed = finished.filter((r) => FAILED.has(r.conclusion))
      return { repo, list, finished, failed }
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
