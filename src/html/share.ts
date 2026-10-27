import * as d3 from 'd3'
import { commitsForAuthor, daysBetween, data, formatWhen, repoColor, repoLabel, withTip } from './common.ts'
import type { AuthorSummary, PullRequestInfo } from './common.ts'
import {
  checksTone,
  ciStats,
  medianDuration,
  prForBranch,
  prLink,
  prPills,
  prStats,
  repoChip,
  reviewStats,
  tiles,
} from './github.ts'
import { branchesFor, isStale } from './insights.ts'

type Container = d3.Selection<HTMLElement, unknown, null, undefined>

const num = d3.format(',')

/** Open PRs that have waited longer than this for a review count as needing attention. */
const REVIEW_WAIT_DAYS = 3
/** Branches further behind base than this count as needing attention. */
const BEHIND_LIMIT = 20

function emptyNote(container: Container, text: string) {
  container.append('p').attr('class', 'hint').text(text)
}

function openDays(pr: PullRequestInfo): number {
  return daysBetween(pr.createdIso.slice(0, 10), data.generatedOn)
}

function plural(n: number, word: string): string {
  return `${num(n)} ${word}${n === 1 ? '' : 's'}`
}

function windowLine(author: AuthorSummary): string {
  return `${author.name}, ${data.window.start} to ${data.window.end}`
}

// ---------------------------------------------------------------------------
// Waiting on review: the message to send reviewers

/** Open, ready PRs by the author with no approval yet and no changes requested; longest waiting first. */
export function waitingPrs(author: AuthorSummary): PullRequestInfo[] {
  return prStats(author)
    .open.filter((p) => !p.isDraft && p.reviewDecision !== 'APPROVED' && p.reviewDecision !== 'CHANGES_REQUESTED')
    .sort((a, b) => (a.createdIso < b.createdIso ? -1 : 1))
}

function reviewersText(pr: PullRequestInfo): string {
  return pr.reviewRequests.length ? pr.reviewRequests.map((r) => `@${r}`).join(', ') : 'no reviewer requested'
}

export function waitingText(author: AuthorSummary): string {
  const prs = waitingPrs(author)
  if (prs.length === 0) return `Nothing waiting on review (${windowLine(author)}).`
  return [
    `Waiting on review (${prs.length}):`,
    ...prs.map((p) => {
      const checks = checksTone(p.checks)?.[0]
      const bits = [
        `waiting on ${reviewersText(p)}`,
        `open ${openDays(p)}d`,
        `+${num(p.additions)}/−${num(p.deletions)}`,
        ...(checks ? [checks] : []),
      ]
      return `- ${repoLabel(p.repo)} #${p.number} ${p.title}: ${p.url} (${bits.join(', ')})`
    }),
  ].join('\n')
}

export function drawWaiting(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const prs = waitingPrs(author)
  if (prs.length === 0) return emptyNote(container, 'Nothing from this author is waiting on review.')

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Repo', 'Pull request', 'Waiting on', 'Open for', 'Size', 'Status'])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(prs).join('tr')
  tr.append('td').each(function (d) {
    repoChip(d3.select(this), d.repo)
  })
  tr.append('td').each(function (d) {
    prLink(d3.select(this), d, true)
  })
  tr.append('td')
    .classed('muted', (d) => d.reviewRequests.length === 0)
    .text((d) => reviewersText(d))
  withTip(
    tr
      .append('td')
      .attr('class', 'nowrap')
      .text((d) => `${openDays(d)}d`)
      .classed('overdue', (d) => openDays(d) > REVIEW_WAIT_DAYS),
    (d) => `Opened ${formatWhen(d.createdIso)}\nLast update ${formatWhen(d.updatedIso)}`,
  )
  tr.append('td')
    .attr('class', 'nowrap muted')
    .text((d) => `+${num(d.additions)} / −${num(d.deletions)}`)
  tr.append('td').each(function (d) {
    prPills(d3.select(this), d)
  })
}

// ---------------------------------------------------------------------------
// Status update: shipped / in progress / needs attention, for a manager

type StatusItem = {
  repo: string
  label: string
  url?: string
  note: string
}

type StatusModel = {
  shipped: StatusItem[]
  progress: StatusItem[]
  attention: StatusItem[]
  /** One-line headline numbers. */
  summary: string[]
}

/** Why an open PR needs the author's (or someone's) attention, if it does. */
function prProblems(pr: PullRequestInfo): string[] {
  const problems: string[] = []
  if (pr.reviewDecision === 'CHANGES_REQUESTED') problems.push('changes requested')
  if (pr.checks === 'failure') problems.push('checks failing')
  const waiting = !pr.isDraft && pr.reviewDecision !== 'APPROVED' && pr.reviewDecision !== 'CHANGES_REQUESTED'
  if (waiting && openDays(pr) > REVIEW_WAIT_DAYS)
    problems.push(`waiting on review ${openDays(pr)}d (${reviewersText(pr)})`)
  return problems
}

function prProgressNote(pr: PullRequestInfo): string {
  if (pr.isDraft) return `draft, open ${openDays(pr)}d`
  if (pr.reviewDecision === 'APPROVED') return 'approved, not merged yet'
  return `in review, open ${openDays(pr)}d`
}

export function statusModel(author: AuthorSummary): StatusModel {
  const commits = commitsForAuthor(author)
  const shipped: StatusItem[] = []
  const progress: StatusItem[] = []
  const attention: StatusItem[] = []
  const summary = [plural(commits.length, 'commit')]

  if (data.github) {
    const { merged, open, toMerge } = prStats(author)
    for (const p of [...merged].sort((a, b) => (a.mergedIso! < b.mergedIso! ? 1 : -1))) {
      shipped.push({
        repo: p.repo,
        label: `#${p.number} ${p.title}`,
        url: p.url,
        note: `merged ${p.mergedIso!.slice(0, 10)}`,
      })
    }
    for (const p of open) {
      const problems = prProblems(p)
      const item = { repo: p.repo, label: `#${p.number} ${p.title}`, url: p.url }
      if (problems.length) attention.push({ ...item, note: problems.join(', ') })
      else progress.push({ ...item, note: prProgressNote(p) })
    }
    const { given } = reviewStats(author)
    const { pct } = ciStats(author)
    summary.push(
      `${plural(merged.length, 'PR')} merged`,
      ...(toMerge.length ? [`median ${medianDuration(toMerge)} to merge`] : []),
      `${plural(open.length, 'PR')} open`,
      `${plural(given.length, 'review')} given`,
      ...(pct !== null ? [`CI ${pct}% passing`] : []),
    )
  } else {
    // Git only: say where the work landed, per repo.
    for (const [repo, list] of d3.group(commits, (c) => c.repo)) {
      shipped.push({ repo, label: plural(list.length, 'commit'), note: `last ${list[list.length - 1]!.day}` })
    }
  }

  const authorRepos = new Set(commits.map((c) => c.repo))
  for (const t of data.tags.filter((t) => authorRepos.has(t.repo))) {
    shipped.push({ repo: t.repo, label: `tag ${t.name}`, note: `tagged ${t.day}` })
  }

  for (const { b, mine } of branchesFor(author)) {
    const pr = prForBranch(b.repo, b.name)
    if (pr?.state === 'OPEN') {
      if (b.behind > BEHIND_LIMIT)
        attention.push({ repo: b.repo, label: b.name, note: `${b.behind} commits behind ${b.base}` })
      continue
    }
    if (pr) continue
    if (b.behind > BEHIND_LIMIT) {
      attention.push({ repo: b.repo, label: b.name, note: `${b.behind} commits behind ${b.base}, no PR` })
    } else if (!isStale(b)) {
      progress.push({ repo: b.repo, label: b.name, note: `${plural(mine, 'commit')}, no PR yet` })
    }
  }

  return { shipped, progress, attention, summary }
}

const COLUMNS = [
  { key: 'shipped', title: 'Shipped', empty: 'Nothing merged in the window.' },
  { key: 'progress', title: 'In progress', empty: 'Nothing open.' },
  { key: 'attention', title: 'Needs attention', empty: 'No blockers.' },
] as const

export function statusText(author: AuthorSummary): string {
  const model = statusModel(author)
  const lines = [`Status update: ${windowLine(author)}`, model.summary.join(' · ')]
  for (const col of COLUMNS) {
    lines.push('', `*${col.title}*`)
    const items = model[col.key]
    if (items.length === 0) lines.push(`- ${col.empty}`)
    for (const item of items) {
      lines.push(`- ${repoLabel(item.repo)} ${item.label} (${item.note})${item.url ? `: ${item.url}` : ''}`)
    }
  }
  return lines.join('\n')
}

export function drawStatus(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const model = statusModel(author)
  const commits = commitsForAuthor(author)

  if (data.github) {
    const { merged, open, toMerge } = prStats(author)
    const { given } = reviewStats(author)
    const { pct, finished } = ciStats(author)
    tiles(container, [
      { label: 'Commits', value: num(commits.length) },
      { label: 'PRs merged', value: num(merged.length) },
      { label: 'Median to merge', value: medianDuration(toMerge) },
      { label: 'Open PRs', value: num(open.length) },
      { label: 'Reviews given', value: num(given.length) },
      { label: 'CI pass rate', value: pct === null ? '—' : `${pct}%`, note: `${num(finished.length)} runs` },
    ])
  } else {
    tiles(container, [
      { label: 'Commits', value: num(commits.length) },
      { label: 'Active days', value: num(new Set(commits.map((c) => c.day)).size) },
      { label: 'Repos', value: num(new Set(commits.map((c) => c.repo)).size) },
      { label: 'Branches in flight', value: num(branchesFor(author).length) },
    ])
  }

  const cols = container.append('div').attr('class', 'status-cols')
  for (const col of COLUMNS) {
    const items = model[col.key]
    const box = cols.append('div').attr('class', `status-col status-${col.key}`)
    box.append('h3').text(`${col.title} (${num(items.length)})`)
    const ul = box.append('ul')
    if (items.length === 0) {
      ul.append('li').attr('class', 'muted').text(col.empty)
      continue
    }
    const li = ul.selectAll('li').data(items).join('li')
    li.append('span')
      .attr('class', 'repo-chip')
      .style('--swatch', (d) => repoColor(d.repo))
      .text((d) => repoLabel(d.repo))
    li.each(function (d) {
      const row = d3.select(this)
      if (d.url) row.append('a').attr('href', d.url).attr('target', '_blank').attr('rel', 'noopener').text(d.label)
      else row.append('code').text(d.label)
    })
    li.append('span')
      .attr('class', 'muted status-note')
      .text((d) => d.note)
  }
}
