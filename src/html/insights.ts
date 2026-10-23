import * as d3 from 'd3'
import { COMMIT_TYPES, SIZE_BUCKETS, commitType, sizeBucket, sizeBucketLabel } from '../commit-kinds.ts'
import {
  commitsForAuthor,
  data,
  fillRepoLegend,
  grain,
  hideTip,
  hourFromIso,
  periodAxisLabel,
  periodOf,
  prefersReducedMotion,
  repoColor,
  repoLabel,
  shortHash,
  showTip,
  styleAxis,
} from './common.ts'
import type { AuthorSummary, Commit } from './common.ts'
import { branchPrCell } from './github.ts'

type Container = d3.Selection<HTMLElement, unknown, null, undefined>

const num = d3.format(',')

function plural(n: number, word: string): string {
  return `${num(n)} ${word}${n === 1 ? '' : 's'}`
}

function emailsOf(author: AuthorSummary): Set<string> {
  return new Set(author.emails.map((e) => e.toLowerCase()))
}

function previousCommitsForAuthor(author: AuthorSummary): Commit[] {
  const emails = emailsOf(author)
  return data.previousCommits.filter((c) => emails.has(c.authorEmail.toLowerCase()))
}

function authorNameFor(email: string): string {
  return data.authors.find((a) => a.emails.includes(email.toLowerCase()))?.name ?? email
}

function linesChanged(c: Commit): number {
  return c.added + c.deleted
}

/** Same x-axis periods as the stacked commits chart. */
export function chartPeriods(): string[] {
  return grain === 'month' || data.days.length > 45 ? data.weekdays : data.days
}

function emptyNote(container: Container, text: string) {
  container.append('p').attr('class', 'hint').text(text)
}

// ---------------------------------------------------------------------------
// KPI tiles

/** Longest run and the run ending at the last slot (today may still be empty). */
function streaks(slots: string[], active: Set<string>): { current: number; longest: number } {
  let longest = 0
  let run = 0
  for (const s of slots) {
    run = active.has(s) ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  let i = slots.length - 1
  if (i >= 0 && !active.has(slots[i]!) && slots[i] === periodOf(data.window.end)) i--
  let current = 0
  while (i >= 0 && active.has(slots[i]!)) {
    current++
    i--
  }
  return { current, longest }
}

function median(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(d3.median(values) ?? 0)
}

type Kpi = { label: string; value: string; now?: number; prev?: number; note?: string }

function kpiStats(commits: Commit[]) {
  return {
    commits: commits.length,
    activeDays: new Set(commits.map((c) => periodOf(c.day))).size,
    added: d3.sum(commits, (c) => c.added),
    deleted: d3.sum(commits, (c) => c.deleted),
    medianSize: median(commits.map(linesChanged)),
    repos: new Set(commits.map((c) => c.repo)).size,
  }
}

export function drawKpis(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const now = kpiStats(commits)
  const prev = data.previousWindow ? kpiStats(previousCommitsForAuthor(author)) : null
  const unit = grain === 'month' ? 'month' : 'weekday'
  const { current, longest } = streaks(data.weekdays, new Set(commits.map((c) => periodOf(c.day))))

  const tiles: Kpi[] = [
    { label: 'Commits', value: num(now.commits), now: now.commits, prev: prev?.commits },
    {
      label: grain === 'month' ? 'Active months' : 'Active days',
      value: num(now.activeDays),
      now: now.activeDays,
      prev: prev?.activeDays,
    },
    { label: 'Lines added', value: `+${num(now.added)}`, now: now.added, prev: prev?.added },
    { label: 'Lines deleted', value: `−${num(now.deleted)}`, now: now.deleted, prev: prev?.deleted },
    {
      label: 'Median commit size',
      value: num(now.medianSize),
      now: now.medianSize,
      prev: prev?.medianSize,
      note: 'lines',
    },
    { label: 'Repos touched', value: `${now.repos} / ${data.repos.length}`, now: now.repos, prev: prev?.repos },
    { label: 'Current streak', value: num(current), note: `${unit}s · longest ${num(longest)}` },
  ]

  const tile = container.selectAll('div.kpi').data(tiles).join('div').attr('class', 'kpi')
  tile
    .append('div')
    .attr('class', 'label')
    .text((d) => d.label)
  tile
    .append('div')
    .attr('class', 'value')
    .text((d) => d.value)
  tile.each(function (d) {
    const el = d3.select(this).append('div').attr('class', 'delta')
    if (d.now === undefined || d.prev === undefined) {
      el.text(d.note ?? '')
      return
    }
    if (d.prev === 0) {
      el.text(d.now === 0 ? 'no change' : 'new vs previous').classed('up', d.now > 0)
      return
    }
    const pct = Math.round(((d.now - d.prev) / d.prev) * 100)
    el.classed('up', pct > 0)
      .classed('down', pct < 0)
      .text(`${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% vs ${num(d.prev)}`)
  })

  d3.select('#kpi-hint').text(
    data.previousWindow
      ? `Compared with ${data.previousWindow.start} → ${data.previousWindow.end}. Line counts skip merges, lock files and build output.`
      : 'All-time window: no earlier period to compare. Line counts skip merges, lock files and build output.',
  )
}

// ---------------------------------------------------------------------------
// Churn: lines added (up) and deleted (down) per period, stacked by repo

export type ChurnScale = 'log' | 'linear'

/** Powers of ten up to `max` (10, 100, 1k, …) so log-axis ticks read as round numbers. */
function decades(max: number): number[] {
  const out: number[] = []
  for (let v = 10; v <= max; v *= 10) out.push(v)
  return out
}

export function drawChurn(container: Container, author: AuthorSummary, scale: ChurnScale) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const periods = chartPeriods()

  type Row = { day: string } & Record<string, number | string>
  const sumBy = (field: 'added' | 'deleted'): Row[] =>
    periods.map((day) => {
      const row: Row = { day }
      for (const repo of data.repos) {
        row[repo] = d3.sum(
          commits.filter((c) => c.repo === repo && periodOf(c.day) === day),
          (c) => c[field],
        )
      }
      return row
    })
  const addedRows = sumBy('added')
  const deletedRows = sumBy('deleted')
  const stack = d3
    .stack<Row>()
    .keys(data.repos)
    .value((d, key) => Number(d[key] ?? 0))
  const up = stack(addedRows)
  const down = stack(deletedRows)

  const maxUp = Math.max(1, d3.max(up[up.length - 1] ?? [], (d) => d[1]) ?? 1)
  const maxDown = Math.max(1, d3.max(down[down.length - 1] ?? [], (d) => d[1]) ?? 1)

  const margin = { top: 12, right: 64, bottom: 32, left: 52 }
  const width = Math.max(640, periods.length * (grain === 'month' ? 28 : 18))
  const height = 280
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Lines added and deleted by ${grain === 'month' ? 'month' : 'day'} for ${author.name}`)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3.scaleBand().domain(periods).range([0, innerW]).padding(0.15)
  // Symlog keeps a 10k-line formatting day from flattening every other bar; linear keeps
  // stacked segments proportional.
  const y =
    scale === 'log'
      ? d3.scaleSymlog().constant(10).domain([-maxDown, maxUp]).range([innerH, 0])
      : d3.scaleLinear().domain([-maxDown, maxUp]).nice().range([innerH, 0])
  const zero = y(0)

  const ticks =
    scale === 'log'
      ? [...decades(maxDown).map((v) => -v), 0, ...decades(maxUp)]
      : (y as d3.ScaleLinear<number, number>).ticks(6)
  g.append('g')
    .call(
      d3
        .axisLeft(y)
        .tickValues(ticks)
        .tickFormat((v) => d3.format('~s')(Math.abs(Number(v)))),
    )
    .call(styleAxis)
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((d) => periodAxisLabel(String(d))))
    .call(styleAxis)
  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', zero)
    .attr('y2', zero)
    .attr('stroke', 'var(--axis-stroke)')

  const tipFor = (day: string) => {
    const inDay = commits.filter((c) => periodOf(c.day) === day)
    const added = d3.sum(inDay, (c) => c.added)
    const deleted = d3.sum(inDay, (c) => c.deleted)
    if (inDay.length === 0) return `${periodAxisLabel(day)}: no commits`
    const label = grain === 'month' ? periodAxisLabel(day) : day
    const net = added - deleted
    const rows = data.repos
      .map((repo) => {
        const rc = inDay.filter((c) => c.repo === repo)
        if (rc.length === 0) return null
        return `${repoLabel(repo)}: +${num(d3.sum(rc, (c) => c.added))} −${num(d3.sum(rc, (c) => c.deleted))}`
      })
      .filter(Boolean)
    return `${label} — +${num(added)} −${num(deleted)} (net ${net >= 0 ? '+' : '−'}${num(Math.abs(net))})\n${rows.join('\n')}`
  }

  const drawSide = (series: d3.Series<Row, string>[], sign: 1 | -1) => {
    const rects = g
      .append('g')
      .selectAll('g')
      .data(series)
      .join('g')
      .attr('fill', (d) => repoColor(d.key))
      .attr('fill-opacity', sign === 1 ? 1 : 0.55)
      .selectAll('rect')
      .data((d) => d)
      .join('rect')
      .attr('x', (d) => x(String(d.data.day))!)
      .attr('width', x.bandwidth())
      .on('mousemove', (event: MouseEvent, d) => showTip(event, tipFor(String(d.data.day))))
      .on('mouseleave', hideTip)
    const top = (d: d3.SeriesPoint<Row>) => (sign === 1 ? y(d[1]) : y(-d[0]))
    const h = (d: d3.SeriesPoint<Row>) => Math.abs(y(sign * d[1]) - y(sign * d[0]))
    if (prefersReducedMotion()) {
      rects.attr('y', top).attr('height', h)
    } else {
      rects.attr('y', zero).attr('height', 0).transition().duration(400).attr('y', top).attr('height', h)
    }
  }
  drawSide(up, 1)
  drawSide(down, -1)

  g.append('text')
    .attr('x', innerW + 8)
    .attr('y', 10)
    .attr('font-size', 11)
    .attr('fill', 'var(--muted)')
    .text('▲ added')
  g.append('text')
    .attr('x', innerW + 8)
    .attr('y', innerH - 6)
    .attr('font-size', 11)
    .attr('fill', 'var(--muted)')
    .text('▼ deleted')

  fillRepoLegend(container.append('div').attr('class', 'chart-legend'))
}

// ---------------------------------------------------------------------------
// Tag markers (drawn into the stacked commits chart)

export function drawTagMarkers(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.ScaleBand<string>,
  innerH: number,
) {
  const byPeriod = d3.group(
    data.tags.filter((t) => x(periodOf(t.day)) !== undefined),
    (t) => periodOf(t.day),
  )
  for (const [period, tags] of byPeriod) {
    const cx = x(period)! + x.bandwidth() / 2
    const tipText = [
      `${period} — ${plural(tags.length, 'tag')}`,
      ...tags.map((t) => `${repoLabel(t.repo)}: ${t.name}`),
    ].join('\n')
    const marker = g.append('g').attr('class', 'tag-marker')
    marker
      .append('line')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', 'var(--muted)')
      .attr('stroke-dasharray', '2 3')
      .attr('opacity', 0.6)
    marker
      .append('path')
      .attr('d', d3.symbol(d3.symbolDiamond, 48)())
      .attr('transform', `translate(${cx},-4)`)
      .attr('fill', 'var(--heading)')
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
  }
}

// ---------------------------------------------------------------------------
// Commit types (Conventional Commits) per repo

export function drawTypes(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  if (commits.length === 0) return emptyNote(container, 'No commits in this window.')

  const rows = [
    { key: 'all', label: 'All repos', commits },
    ...data.repos
      .map((repo) => ({ key: repo, label: repoLabel(repo), commits: commits.filter((c) => c.repo === repo) }))
      .filter((r) => r.commits.length > 0),
  ]
  const present = COMMIT_TYPES.filter((t) => commits.some((c) => commitType(c.subject) === t))

  const labelW = 96
  const rowH = 26
  const width = 520
  const barW = width - labelW - 44
  const height = rows.length * rowH + 4

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Commit types per repository for ${author.name}`)

  rows.forEach((row, ri) => {
    const y = ri * rowH + 2
    const byType = d3.group(row.commits, (c) => commitType(c.subject))
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', y + rowH / 2 + 2)
      .attr('font-size', 12)
      .attr('font-weight', ri === 0 ? 650 : 400)
      .attr('fill', ri === 0 ? 'var(--accent)' : 'var(--ink)')
      .text(row.label)
    svg
      .append('text')
      .attr('x', width)
      .attr('y', y + rowH / 2 + 2)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(num(row.commits.length))

    let offset = 0
    for (const t of present) {
      const list = byType.get(t) ?? []
      if (list.length === 0) continue
      const w = (list.length / row.commits.length) * barW
      const pct = Math.round((list.length / row.commits.length) * 100)
      const examples = list
        .slice(-4)
        .reverse()
        .map((c) => `• ${c.subject}`)
      svg
        .append('rect')
        .attr('x', labelW + offset)
        .attr('y', y + 4)
        .attr('width', Math.max(0, w - 1))
        .attr('height', rowH - 10)
        .attr('rx', 2)
        .attr('fill', `var(--type-${t})`)
        .on('mousemove', (event: MouseEvent) =>
          showTip(event, [`${row.label} · ${t}: ${list.length} (${pct}%)`, ...examples].join('\n')),
        )
        .on('mouseleave', hideTip)
      offset += w
    }
  })

  const legend = container.append('div').attr('class', 'chart-legend')
  for (const t of present) legend.append('span').style('--swatch', `var(--type-${t})`).text(t)
}

// ---------------------------------------------------------------------------
// Commit size histogram

export function drawSizes(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author).filter((c) => commitType(c.subject) !== 'merge')
  if (commits.length === 0) return emptyNote(container, 'No commits in this window.')

  const buckets = SIZE_BUCKETS.map((b) => b.key)
  type Row = { bucket: string } & Record<string, number | string>
  const rows: Row[] = buckets.map((bucket) => {
    const row: Row = { bucket }
    for (const repo of data.repos) {
      row[repo] = commits.filter((c) => c.repo === repo && sizeBucket(linesChanged(c)) === bucket).length
    }
    return row
  })
  const stacked = d3
    .stack<Row>()
    .keys(data.repos)
    .value((d, key) => Number(d[key] ?? 0))(rows)
  const max = Math.max(1, d3.max(stacked[stacked.length - 1] ?? [], (d) => d[1]) ?? 1)

  const margin = { top: 12, right: 12, bottom: 32, left: 32 }
  const width = 520
  const height = 240
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom
  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Commit size distribution for ${author.name}`)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
  const x = d3.scaleBand().domain(buckets).range([0, innerW]).padding(0.25)
  const y = d3.scaleLinear().domain([0, max]).nice().range([innerH, 0])
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((d) => sizeBucketLabel(d as (typeof buckets)[number])))
    .call(styleAxis)
  g.append('g').call(d3.axisLeft(y).ticks(4)).call(styleAxis)

  const tipFor = (bucket: string) => {
    const inBucket = commits
      .filter((c) => sizeBucket(linesChanged(c)) === bucket)
      .sort((a, b) => linesChanged(b) - linesChanged(a))
    const head = `${sizeBucketLabel(bucket as (typeof buckets)[number])} lines — ${plural(inBucket.length, 'commit')}`
    const top = inBucket
      .slice(0, 5)
      .map((c) => `• ${repoLabel(c.repo)} ${shortHash(c.hash)} +${num(c.added)} −${num(c.deleted)} ${c.subject}`)
    return [head, ...top].join('\n')
  }

  const rects = g
    .selectAll('g.layer')
    .data(stacked)
    .join('g')
    .attr('class', 'layer')
    .attr('fill', (d) => repoColor(d.key))
    .selectAll('rect')
    .data((d) => d)
    .join('rect')
    .attr('x', (d) => x(String(d.data.bucket))!)
    .attr('width', x.bandwidth())
    .on('mousemove', (event: MouseEvent, d) => showTip(event, tipFor(String(d.data.bucket))))
    .on('mouseleave', hideTip)
  if (prefersReducedMotion()) {
    rects.attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
  } else {
    rects
      .attr('y', innerH)
      .attr('height', 0)
      .transition()
      .duration(400)
      .attr('y', (d) => y(d[1]))
      .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
  }
  fillRepoLegend(container.append('div').attr('class', 'chart-legend'))
}

// ---------------------------------------------------------------------------
// Punchcard: weekday × hour

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
}

export function drawPunchcard(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const counts = d3.range(7).map(() => d3.range(24).map(() => 0))
  for (const c of commits) counts[weekdayOf(c.day)]![hourFromIso(c.iso)]!++
  const max = Math.max(1, d3.max(counts.flat()) ?? 1)

  const labelW = 40
  const col = 26
  const rowH = 28
  const totalW = 44
  const top = 18
  const width = labelW + 24 * col + totalW
  const height = top + 7 * rowH + 4
  const r = d3
    .scaleSqrt()
    .domain([0, max])
    .range([0, rowH / 2 - 2])

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Commits by weekday and hour for ${author.name}`)

  for (let h = 0; h < 24; h += 3) {
    svg
      .append('text')
      .attr('x', labelW + h * col + col / 2)
      .attr('y', 11)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(String(h).padStart(2, '0'))
  }

  counts.forEach((row, wi) => {
    const cy = top + wi * rowH + rowH / 2
    const weekend = wi >= 5
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', cy + 4)
      .attr('font-size', 12)
      .attr('fill', weekend ? 'var(--muted)' : 'var(--ink)')
      .text(WEEKDAYS[wi]!)
    svg
      .append('line')
      .attr('x1', labelW)
      .attr('x2', labelW + 24 * col)
      .attr('y1', cy)
      .attr('y2', cy)
      .attr('stroke', 'var(--line)')
    svg
      .append('text')
      .attr('x', width)
      .attr('y', cy + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(num(d3.sum(row)))

    row.forEach((n, h) => {
      if (n === 0) return
      const tipText = `${WEEKDAYS[wi]} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 — ${plural(n, 'commit')}`
      const dot = svg
        .append('circle')
        .attr('cx', labelW + h * col + col / 2)
        .attr('cy', cy)
        .attr('r', r(n))
        .attr('fill', 'var(--clock)')
        .attr('fill-opacity', weekend ? 0.6 : 0.9)
        .style('filter', 'drop-shadow(0 0 3px var(--workspace-glow))')
        .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
        .on('mouseleave', hideTip)
      if (!prefersReducedMotion()) {
        dot
          .attr('r', 0)
          .transition()
          .delay(h * 8)
          .duration(300)
          .attr('r', r(n))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Hotspots: most-changed files or folders

export type HotspotMode = 'files' | 'folders'

function folderOf(path: string): string {
  const parts = path.split('/')
  if (parts.length === 1) return '(root)'
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

function truncateLeft(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - max + 1)}`
}

export function drawHotspots(container: Container, author: AuthorSummary, mode: HotspotMode) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  type Spot = { repo: string; path: string; added: number; deleted: number; commits: Set<string> }
  const spots = new Map<string, Spot>()
  for (const c of commits) {
    for (const f of c.files) {
      const path = mode === 'files' ? f.path : folderOf(f.path)
      const key = `${c.repo}\u0000${path}`
      let s = spots.get(key)
      if (!s) {
        s = { repo: c.repo, path, added: 0, deleted: 0, commits: new Set() }
        spots.set(key, s)
      }
      s.added += f.added
      s.deleted += f.deleted
      s.commits.add(c.hash)
    }
  }
  // Rank by how often a path was touched, then by lines; touches say more about focus than size does.
  const top = [...spots.values()]
    .sort((a, b) => b.commits.size - a.commits.size || b.added + b.deleted - (a.added + a.deleted))
    .slice(0, 15)
  if (top.length === 0) return emptyNote(container, 'No file changes in this window.')

  const labelW = 300
  const rowH = 22
  const valueW = 150
  const width = 900
  const barW = width - labelW - valueW
  const height = top.length * rowH + 4
  const maxCommits = d3.max(top, (s) => s.commits.size) ?? 1
  const x = d3.scaleLinear().domain([0, maxCommits]).range([0, barW])

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Most changed ${mode} for ${author.name}`)

  top.forEach((s, i) => {
    const y = i * rowH + 2
    const tipText = `${repoLabel(s.repo)} · ${s.path}\n${plural(s.commits.size, 'commit')} · +${num(s.added)} −${num(s.deleted)}`
    svg
      .append('text')
      .attr('x', labelW - 8)
      .attr('y', y + rowH / 2 + 3)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('font-family', 'var(--mono)')
      .attr('fill', 'var(--ink)')
      .text(truncateLeft(s.path, 40))
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
    const bar = svg
      .append('rect')
      .attr('x', labelW)
      .attr('y', y + 4)
      .attr('height', rowH - 8)
      .attr('rx', 2)
      .attr('fill', repoColor(s.repo))
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
    if (prefersReducedMotion()) bar.attr('width', x(s.commits.size))
    else bar.attr('width', 0).transition().duration(400).attr('width', x(s.commits.size))
    svg
      .append('text')
      .attr('x', labelW + x(s.commits.size) + 6)
      .attr('y', y + rowH / 2 + 3)
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(`${s.commits.size} · +${num(s.added)} −${num(s.deleted)}`)
  })
  fillRepoLegend(container.append('div').attr('class', 'chart-legend'))
}

// ---------------------------------------------------------------------------
// Work in flight: branches with unmerged commits

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / 86_400_000)
}

export function drawBranches(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const emails = emailsOf(author)
  const rows = data.branches
    .map((b) => ({
      b,
      mine: Object.entries(b.authors)
        .filter(([e]) => emails.has(e))
        .reduce((n, [, k]) => n + k, 0),
    }))
    .filter((r) => r.mine > 0)
  if (rows.length === 0) {
    return emptyNote(container, 'No branches with unmerged commits from this author moved in the window.')
  }

  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data([
      'Repo',
      'Branch',
      'Unmerged (theirs / all)',
      'Behind base',
      'Last commit',
      ...(data.github ? ['Pull request'] : []),
    ])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr')
  tr.append('td')
    .append('span')
    .attr('class', 'repo-chip')
    .style('--swatch', (d) => repoColor(d.b.repo))
    .text((d) => repoLabel(d.b.repo))
  tr.append('td')
    .append('code')
    .text((d) => d.b.name)
    .attr('title', (d) => `${d.b.ref} vs ${d.b.base}`)
  tr.append('td').text((d) => `${d.mine} / ${d.b.ahead}`)
  tr.append('td')
    .text((d) => (d.b.behind === 0 ? 'up to date' : `${d.b.behind} behind ${d.b.base}`))
    .classed('muted', (d) => d.b.behind === 0)
  tr.append('td').each(function (d) {
    const day = d.b.lastIso.slice(0, 10)
    const age = daysBetween(day, data.window.end)
    const cell = d3.select(this)
    cell.append('span').text(age <= 0 ? 'today' : `${age}d ago`)
    if (age > 7) cell.append('span').attr('class', 'stale').text('stale')
  })
  if (data.github) {
    tr.append('td').each(function (d) {
      branchPrCell(d3.select(this), d.b.repo, d.b.name)
    })
  }
}

// ---------------------------------------------------------------------------
// Collaboration: ownership share and co-authors on the same files

export function drawCollab(container: Container, author: AuthorSummary) {
  container.selectAll('*').remove()
  const emails = emailsOf(author)
  const isMine = (c: Commit) => emails.has(c.authorEmail.toLowerCase())

  const rows = data.repos
    .map((repo) => {
      const repoCommits = data.allCommits.filter((c) => c.repo === repo)
      const mine = repoCommits.filter(isMine)
      if (mine.length === 0) return null
      const myFiles = new Set(mine.flatMap((c) => c.files.map((f) => f.path)))
      const repoChurn = d3.sum(repoCommits, linesChanged)
      const myChurn = d3.sum(mine, linesChanged)

      let sharedMine = 0
      let sharedOthers = 0
      const coauthors = new Map<string, number>()
      for (const c of repoCommits) {
        for (const f of c.files) {
          if (!myFiles.has(f.path)) continue
          const lines = f.added + f.deleted
          if (isMine(c)) sharedMine += lines
          else {
            sharedOthers += lines
            coauthors.set(c.authorEmail, (coauthors.get(c.authorEmail) ?? 0) + lines)
          }
        }
      }
      return {
        repo,
        files: myFiles.size,
        repoShare: repoChurn === 0 ? 0 : myChurn / repoChurn,
        fileShare: sharedMine + sharedOthers === 0 ? 1 : sharedMine / (sharedMine + sharedOthers),
        coauthors: [...coauthors].sort((a, b) => b[1] - a[1]).slice(0, 3),
      }
    })
    .filter((r) => r !== null)
  if (rows.length === 0) return emptyNote(container, 'No commits from this author in the window.')

  const pct = d3.format('.0%')
  const table = container.append('table').attr('class', 'compact')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Repo', 'Share of repo changes', 'Files touched', 'Share on those files', 'Others on the same files'])
    .join('th')
    .text((d) => d)
  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr')
  tr.append('td')
    .append('span')
    .attr('class', 'repo-chip')
    .style('--swatch', (d) => repoColor(d.repo))
    .text((d) => repoLabel(d.repo))
  const meter = (
    cell: d3.Selection<HTMLTableCellElement, (typeof rows)[number], HTMLTableSectionElement, unknown>,
    value: (d: (typeof rows)[number]) => number,
  ) => {
    const wrap = cell.append('div').attr('class', 'meter')
    wrap
      .append('div')
      .attr('class', 'meter-track')
      .append('div')
      .attr('class', 'meter-fill')
      .style('width', (d) => pct(value(d)))
      .style('background', (d) => repoColor(d.repo))
    wrap.append('span').text((d) => pct(value(d)))
  }
  meter(tr.append('td'), (d) => d.repoShare)
  tr.append('td').text((d) => num(d.files))
  meter(tr.append('td'), (d) => d.fileShare)
  tr.append('td')
    .text((d) =>
      d.coauthors.length === 0
        ? '—'
        : d.coauthors.map(([email, lines]) => `${authorNameFor(email)} (${num(lines)})`).join(', '),
    )
    .classed('muted', (d) => d.coauthors.length === 0)
}
