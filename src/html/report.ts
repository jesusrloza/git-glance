import * as d3 from 'd3'
import {
  animateOpacity,
  commitsForAuthor,
  commitsInPeriod,
  cssVar,
  data,
  fillRepoLegend,
  formatTooltip,
  grain,
  hideTip,
  inkOn,
  marksFor,
  periodAxisLabel,
  periodOf,
  prefersReducedMotion,
  repoColor,
  repoLabel,
  shortHash,
  showTip,
  styleAxis,
  tip,
} from './common.ts'
import type { AuthorSummary, Commit } from './common.ts'
import { exportPng, setupPrintTheme } from './export.ts'
import { drawCi, drawPullRequests, drawReviews } from './github.ts'
import {
  type ChurnScale,
  type HotspotMode,
  chartPeriods,
  drawBranches,
  drawChurn,
  drawCollab,
  drawHotspots,
  drawKpis,
  drawPunchcard,
  drawSizes,
  drawTagMarkers,
  drawTypes,
} from './insights.ts'

const cell = 18
const gap = 4
const labelW = 110
const dividerGap = 10

function drawLaneCell(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  opts: {
    x: number
    y: number
    size: number
    committed: boolean
    weekend: boolean
    fill: string
    tipText: string
    delay: number
    glow: string
  },
) {
  const { x, y, size, committed, weekend, fill, tipText, delay, glow } = opts
  const emptyFill = 'var(--empty)'
  const emptyStroke = 'var(--empty-stroke)'
  const opacity = weekend && !committed ? 0.7 : 1
  const shadow = committed ? `drop-shadow(0 0 2px ${glow})` : 'none'

  if (weekend) {
    const shape = svg
      .append('circle')
      .attr('cx', x + size / 2)
      .attr('cy', y + size / 2)
      .attr('r', size / 2 - 1)
      .attr('fill', committed ? fill : emptyFill)
      .attr('stroke', committed ? 'transparent' : emptyStroke)
      .attr('stroke-width', committed ? 0 : 1.5)
      .style('filter', shadow)
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)
    animateOpacity(shape as unknown as d3.Selection<SVGElement, unknown, null, undefined>, delay, opacity)
    return
  }

  const shape = svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', size)
    .attr('height', size)
    .attr('rx', 3)
    .attr('fill', committed ? fill : emptyFill)
    .attr('stroke', committed ? 'transparent' : emptyStroke)
    .attr('stroke-width', committed ? 0 : 1.5)
    .style('filter', shadow)
    .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
    .on('mouseleave', hideTip)
  animateOpacity(shape as unknown as d3.Selection<SVGElement, unknown, null, undefined>, delay, opacity)
}

const monthPitch = 56
const weekPitch = 32
const laneBox = cell
const groupGap = 44

type LaneColumn = {
  id: string
  kind: 'month' | 'week'
  month: string
  week: number
  start: string
  end: string
  pitch: number
}

let lanesSig = ''

function utcNoon(day: string): Date {
  return new Date(`${day}T12:00:00Z`)
}

function formatUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addUtcDays(day: string, n: number): string {
  const d = utcNoon(day)
  d.setUTCDate(d.getUTCDate() + n)
  return formatUtcDay(d)
}

function lastDayOfMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return `${ym}-28`
  return formatUtcDay(new Date(Date.UTC(Number(m[1]), Number(m[2]), 0, 12)))
}

function clampRange(start: string, end: string): { start: string; end: string } | null {
  const clippedStart = start < data.window.start ? data.window.start : start
  const clippedEnd = end > data.window.end ? data.window.end : end
  if (clippedStart > clippedEnd) return null
  return { start: clippedStart, end: clippedEnd }
}

function mondayOf(day: string): string {
  const dow = utcNoon(day).getUTCDay()
  return addUtcDays(day, dow === 0 ? -6 : 1 - dow)
}

/** ISO week number of the week whose Thursday is `thursday`. */
function isoWeekNumber(thursday: string): number {
  const year = utcNoon(thursday).getUTCFullYear()
  const week1Monday = utcNoon(mondayOf(`${year}-01-04`))
  const monday = utcNoon(mondayOf(thursday))
  const diffDays = Math.round((monday.getTime() - week1Monday.getTime()) / 86_400_000)
  return Math.floor(diffDays / 7) + 1
}

/**
 * ISO weeks whose Thursday falls in this month and that overlap the window.
 * A week that crosses a month boundary is owned by the Thursday's month, so the
 * week number is never drawn twice.
 */
function weeksInMonth(ym: string): { week: number; start: string; end: string }[] {
  const monthStart = `${ym}-01`
  const monthEnd = lastDayOfMonth(ym)
  const weeks: { week: number; start: string; end: string }[] = []
  let monday = mondayOf(monthStart)
  while (true) {
    const thursday = addUtcDays(monday, 3)
    if (thursday > monthEnd) break
    if (thursday >= monthStart) {
      const clipped = clampRange(monday, addUtcDays(monday, 6))
      if (clipped) weeks.push({ week: isoWeekNumber(thursday), start: clipped.start, end: clipped.end })
    }
    monday = addUtcDays(monday, 7)
  }
  return weeks
}

function monthColumn(ym: string): LaneColumn {
  const clipped = clampRange(`${ym}-01`, lastDayOfMonth(ym)) ?? { start: `${ym}-01`, end: `${ym}-01` }
  return {
    id: ym,
    kind: 'month',
    month: ym,
    week: 0,
    start: clipped.start,
    end: clipped.end,
    pitch: monthPitch,
  }
}

function weekColumn(ym: string, week: { week: number; start: string; end: string }): LaneColumn {
  return {
    id: `${ym}-W${week.week}`,
    kind: 'week',
    month: ym,
    week: week.week,
    start: week.start,
    end: week.end,
    pitch: weekPitch,
  }
}

function laneRowWidth(cols: LaneColumn[]): number {
  let width = labelW + 20
  cols.forEach((col, i) => {
    if (i > 0 && cols[i - 1]!.month !== col.month) width += groupGap
    width += col.pitch
  })
  return width
}

/** Replace the newest month that spans at least two weeks. A one-week month stays one cell. */
function splitNewestMonth(cols: LaneColumn[]): LaneColumn[] | null {
  for (let i = cols.length - 1; i >= 0; i--) {
    const col = cols[i]!
    if (col.kind !== 'month') continue
    const weeks = weeksInMonth(col.month)
    if (weeks.length < 2) continue
    return [...cols.slice(0, i), ...weeks.map((week) => weekColumn(col.month, week)), ...cols.slice(i + 1)]
  }
  return null
}

function fitMonthColumns(avail: number): LaneColumn[] {
  let cols = data.days.map((ym) => monthColumn(ym))
  if (avail <= 0) return cols
  while (laneRowWidth(cols) < avail) {
    const next = splitNewestMonth(cols)
    if (!next) break
    if (laneRowWidth(next) > avail) break
    cols = next
  }
  return cols
}

function commitsInRange(commits: Commit[], start: string, end: string, repo?: string): Commit[] {
  return commits.filter((c) => c.day >= start && c.day <= end && (repo === undefined || c.repo === repo))
}

function columnTip(col: LaneColumn, commits: Commit[]): string {
  const month = periodAxisLabel(col.month)
  const span = `${Number(col.start.slice(8, 10))}–${Number(col.end.slice(8, 10))}`
  const label = col.kind === 'week' ? `${month} · week ${col.week} · ${span}` : month
  if (commits.length === 0) return `${label}: no commits`
  return [
    `${label} — ${commits.length} commit${commits.length === 1 ? '' : 's'}`,
    ...commits.map((c) => `• ${c.iso.slice(11, 16)} ${repoLabel(c.repo)} ${shortHash(c.hash)} ${c.subject}`),
  ].join('\n')
}

function drawMonthLanes(container: d3.Selection<HTMLElement, unknown, null, undefined>, author: AuthorSummary) {
  const avail = Math.floor(container.node()?.clientWidth ?? 0)
  const cols = fitMonthColumns(avail)
  const sig = `${author.emails.join('|')}:${cols.map((col) => col.id).join(',')}`
  if (sig === lanesSig && !container.select('svg').empty()) return
  lanesSig = sig

  container.selectAll('*').remove()
  fillRepoLegend(d3.select('#lanes-repo-legend'))

  const commits = commitsForAuthor(author)
  const hasWeeks = cols.some((col) => col.kind === 'week')
  const hint = document.getElementById('lanes-hint')
  if (hint) {
    hint.hidden = !hasWeeks
    hint.textContent = hasWeeks ? 'Older months are one cell; recent months are split into weeks.' : ''
  }

  const headerH = hasWeeks ? 48 : 36
  const rowH = laneBox + gap
  const width = laneRowWidth(cols)
  const height = headerH + rowH + dividerGap + data.repos.length * rowH + 8
  const xs: number[] = []
  let cursor = labelW
  cols.forEach((col, i) => {
    if (i > 0 && cols[i - 1]!.month !== col.month) cursor += groupGap
    xs.push(cursor)
    cursor += col.pitch
  })

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', width)
    .attr('height', height)
    .style('max-width', '100%')
    .style('height', 'auto')
    .attr('role', 'img')
    .attr('aria-label', `Repo lanes for ${author.name}: workspace activity and per-repository periods`)

  let index = 0
  while (index < cols.length) {
    const month = cols[index]!.month
    let end = index
    while (end < cols.length && cols[end]!.month === month) end++
    const expanded = cols.slice(index, end).some((col) => col.kind === 'week')
    const left = xs[index]!
    const right = xs[end - 1]! + cols[end - 1]!.pitch
    const mid = (left + right) / 2
    svg
      .append('text')
      .attr('x', mid)
      .attr('y', 13)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', 'var(--muted)')
      .text(periodAxisLabel(month))
    svg
      .append('line')
      .attr('x1', left + 6)
      .attr('x2', right - 6)
      .attr('y1', 20)
      .attr('y2', 20)
      .attr('stroke', 'var(--muted)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '1.5 3')
      .attr('stroke-linecap', 'round')
    if (expanded) {
      for (let k = index; k < end; k++) {
        const col = cols[k]!
        svg
          .append('text')
          .attr('x', xs[k]! + col.pitch / 2)
          .attr('y', 36)
          .attr('text-anchor', 'middle')
          .attr('font-size', 11)
          .attr('fill', 'var(--muted)')
          .text(String(col.week))
      }
    }
    index = end
  }

  const paintRow = (y: number, repo: string | undefined, fill: string, glow: string, rowDelay: number) => {
    cols.forEach((col, di) => {
      const matched = commitsInRange(commits, col.start, col.end, repo)
      drawLaneCell(svg, {
        x: xs[di]! + (col.pitch - laneBox) / 2,
        y,
        size: laneBox,
        committed: matched.length > 0,
        weekend: false,
        fill,
        tipText: columnTip(col, matched),
        delay: di * 4 + rowDelay,
        glow,
      })
    })
  }

  const labelStyle = (text: d3.Selection<SVGTextElement, unknown, null, undefined>, y: number, fill: string) => {
    text
      .attr('x', 0)
      .attr('y', y + laneBox / 2 + 4)
      .attr('font-size', 12)
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', fill)
  }

  const wsY = headerH
  labelStyle(svg.append('text').attr('font-weight', 650).text('workspace'), wsY, 'var(--accent)')
  paintRow(wsY, undefined, 'var(--workspace-fill)', 'var(--workspace-glow)', 0)

  const divY = wsY + rowH + dividerGap / 2
  svg
    .append('line')
    .attr('x1', 0)
    .attr('x2', width - 10)
    .attr('y1', divY)
    .attr('y2', divY)
    .attr('stroke', 'var(--divider)')
    .attr('stroke-dasharray', '4 4')

  data.repos.forEach((row, ri) => {
    const y = headerH + rowH + dividerGap + ri * rowH
    labelStyle(svg.append('text').text(repoLabel(row)), y, 'var(--ink)')
    paintRow(y, row, repoColor(row), 'var(--repo-glow)', (ri + 1) * 12)
  })
}

function drawLanes(container: d3.Selection<HTMLElement, unknown, null, undefined>, author: AuthorSummary) {
  if (grain === 'month') {
    drawMonthLanes(container, author)
    return
  }
  const lanesHint = document.getElementById('lanes-hint')
  if (lanesHint) lanesHint.hidden = true

  container.selectAll('*').remove()
  fillRepoLegend(d3.select('#lanes-repo-legend'))

  const commits = commitsForAuthor(author)
  const { workspace, repos } = marksFor(commits)
  const repoRows = data.repos
  // Month columns are wide enough for "Jun 26". Day columns stay 18px squares.
  const pitch = grain === 'month' ? 56 : cell + gap
  const box = grain === 'month' ? 22 : cell
  const boxInset = (pitch - box) / 2
  const width = labelW + data.days.length * pitch + 20
  const rowH = box + gap
  const headerH = 40
  const height = headerH + rowH + dividerGap + repoRows.length * rowH + 8
  const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', width)
    .attr('height', height)
    .style('max-width', '100%')
    .style('height', 'auto')
    .attr('role', 'img')
    .attr('aria-label', `Repo lanes for ${author.name}: workspace activity and per-repository periods`)

  if (grain === 'day') {
    svg
      .selectAll('text.day-dow')
      .data(data.days)
      .join('text')
      .attr('class', 'day-dow')
      .attr('x', (_, i) => labelW + i * pitch + boxInset + box / 2)
      .attr('y', 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', 9)
      .attr('fill', 'var(--muted)')
      .text((d) => weekdayShort[new Date(`${d}T12:00:00Z`).getUTCDay()]!)

    svg
      .selectAll('text.day-num')
      .data(data.days)
      .join('text')
      .attr('class', 'day-num')
      .attr('x', (_, i) => labelW + i * pitch + boxInset + box / 2)
      .attr('y', 26)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text((d) => String(Number(d.slice(8, 10))))
  } else {
    svg
      .selectAll('text.day-num')
      .data(data.days)
      .join('text')
      .attr('class', 'day-num')
      .attr('x', (_, i) => labelW + i * pitch + pitch / 2)
      .attr('y', 22)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', 'var(--muted)')
      .text((d) => periodAxisLabel(d))
  }

  const wsY = headerH
  svg
    .append('text')
    .attr('x', 0)
    .attr('y', wsY + box / 2 + 4)
    .attr('font-size', 12)
    .attr('font-weight', 650)
    .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
    .attr('fill', 'var(--accent)')
    .text('workspace')

  data.days.forEach((day, di) => {
    const committed = workspace[day] === 'committed'
    const weekend = grain === 'day' && [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())
    const dayCommits = commitsInPeriod(commits, day)
    const tipText = formatTooltip(day, dayCommits)

    drawLaneCell(svg, {
      x: labelW + di * pitch + boxInset,
      y: wsY,
      size: box,
      committed,
      weekend,
      fill: 'var(--workspace-fill)',
      tipText,
      delay: di * 4,
      glow: 'var(--workspace-glow)',
    })
  })

  const divY = wsY + rowH + dividerGap / 2
  svg
    .append('line')
    .attr('x1', 0)
    .attr('x2', width - 10)
    .attr('y1', divY)
    .attr('y2', divY)
    .attr('stroke', 'var(--divider)')
    .attr('stroke-dasharray', '4 4')

  repoRows.forEach((row, ri) => {
    const y = headerH + rowH + dividerGap + ri * rowH
    const label = repoLabel(row)
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', y + box / 2 + 4)
      .attr('font-size', 12)
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', 'var(--ink)')
      .text(label)

    const marks = repos[row]!
    data.days.forEach((day, di) => {
      const committed = marks[day] === 'committed'
      const weekend = grain === 'day' && [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())
      const dayCommits = commitsInPeriod(commits, day, row)

      drawLaneCell(svg, {
        x: labelW + di * pitch + boxInset,
        y,
        size: box,
        committed,
        weekend,
        fill: repoColor(row),
        tipText: formatTooltip(day, dayCommits),
        delay: di * 4 + (ri + 1) * 12,
        glow: 'var(--repo-glow)',
      })
    })
  })
}

function drawBarChart(container: d3.Selection<HTMLElement, unknown, null, undefined>, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const periods = data.weekdays
  const counts = periods.map((p) => commitsInPeriod(commits, p).length)
  const max = Math.max(1, d3.max(counts) ?? 1)
  const margin = { top: 20, right: 16, bottom: 40, left: 36 }
  const width = Math.max(640, periods.length * (grain === 'month' ? 36 : 22))
  const height = 220
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `${grain === 'month' ? 'Monthly' : 'Weekday'} commit volume for ${author.name}`)

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3.scaleBand().domain(periods).range([0, innerW]).padding(0.2)
  const y = d3.scaleLinear().domain([0, max]).nice().range([innerH, 0])

  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((d) => periodAxisLabel(String(d))))
    .call(styleAxis)

  g.append('g').call(d3.axisLeft(y).ticks(5)).call(styleAxis)

  const bars = g
    .selectAll('rect.bar')
    .data(periods)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', (d) => x(d)!)
    .attr('width', x.bandwidth())
    .attr('fill', 'var(--accent)')
    .attr('rx', 2)
    .style('filter', 'drop-shadow(0 0 4px var(--workspace-glow))')
    .on('mousemove', (event: MouseEvent, day: string) =>
      showTip(event, formatTooltip(day, commitsInPeriod(commits, day))),
    )
    .on('mouseleave', hideTip)

  if (prefersReducedMotion()) {
    bars.attr('y', (d, i) => y(counts[i]!)).attr('height', (d, i) => innerH - y(counts[i]!))
  } else {
    bars
      .attr('y', innerH)
      .attr('height', 0)
      .transition()
      .duration(400)
      .ease(d3.easeCubicOut)
      .attr('y', (d, i) => y(counts[i]!))
      .attr('height', (d, i) => innerH - y(counts[i]!))
  }
}

function drawStack(container: d3.Selection<HTMLElement, unknown, null, undefined>, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const days = chartPeriods()

  type DayStack = { day: string } & Record<string, number | string>
  const series: DayStack[] = days.map((day) => {
    const row: DayStack = { day }
    for (const repo of data.repos) {
      row[repo] = commitsInPeriod(commits, day, repo).length
    }
    return row
  })

  const stacked = d3
    .stack<DayStack>()
    .keys(data.repos)
    .value((d, key) => Number(d[key] ?? 0))(series)

  const max = Math.max(1, d3.max(stacked[stacked.length - 1] ?? [], (d) => d[1]) ?? 1)

  const margin = { top: 16, right: 16, bottom: 40, left: 36 }
  const width = Math.max(640, days.length * (grain === 'month' ? 28 : 18))
  const height = 240
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', `Commits by ${grain === 'month' ? 'month' : 'day'} and repository for ${author.name}`)

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3.scaleBand().domain(days).range([0, innerW]).padding(0.15)
  const y = d3.scaleLinear().domain([0, max]).nice().range([innerH, 0])

  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((d) => periodAxisLabel(String(d))))
    .call(styleAxis)

  g.append('g').call(d3.axisLeft(y).ticks(5)).call(styleAxis)
  drawTagMarkers(g, x, innerH)

  const layers = g
    .selectAll('g.layer')
    .data(stacked)
    .join('g')
    .attr('class', 'layer')
    .attr('fill', (d) => repoColor(d.key))

  const rects = layers
    .selectAll('rect')
    .data((d) => d)
    .join('rect')
    .attr('x', (d) => x(String(d.data.day))!)
    .attr('width', x.bandwidth())
    .on('mousemove', (event: MouseEvent, d) => {
      const day = String(d.data.day)
      const label = grain === 'month' ? periodAxisLabel(day) : day
      const counts = data.repos.map((repo) => ({ repo, n: Number(d.data[repo] ?? 0) })).filter((r) => r.n > 0)
      const total = d3.sum(counts, (r) => r.n)
      const parts = counts.map((r) => `${repoLabel(r.repo)}: ${r.n}`)
      showTip(
        event,
        total > 0 ? `${label} — ${total} commit${total === 1 ? '' : 's'}\n${parts.join('\n')}` : `${label}: no commits`,
      )
    })
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

  const legend = container.append('div').attr('class', 'chart-legend')
  fillRepoLegend(legend)
}

function drawHeatmap(container: d3.Selection<HTMLElement, unknown, null, undefined>) {
  container.selectAll('*').remove()
  const authors = data.authors
  const repos = data.repos
  const matrix = authors.map((a) => {
    const commits = commitsForAuthor(a)
    return repos.map((repo) => commits.filter((c) => c.repo === repo).length)
  })
  const max = Math.max(1, d3.max(matrix.flat()) ?? 1)

  const labelWHeat = 140
  const cellW = 72
  const cellH = 28
  const width = labelWHeat + repos.length * cellW + 20
  const height = 28 + authors.length * cellH + 10

  const low = cssVar('--heatmap-low') || '#134e4a'
  const high = cssVar('--heatmap-high') || '#5eead4'
  const color = d3.scaleSequential(d3.interpolateRgb(low, high)).domain([0, max])

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', 'Commit counts by author and repository')

  repos.forEach((repo, i) => {
    svg
      .append('text')
      .attr('x', labelWHeat + i * cellW + cellW / 2)
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', 'var(--muted)')
      .text(repoLabel(repo))
  })

  authors.forEach((author, ri) => {
    const y = 24 + ri * cellH
    svg
      .append('text')
      .attr('x', 0)
      .attr('y', y + cellH / 2 + 4)
      .attr('font-size', 11)
      .attr('fill', author.isSubject ? 'var(--accent)' : 'var(--ink)')
      .attr('font-weight', author.isSubject ? 650 : 400)
      .text(author.name)

    repos.forEach((repo, ci) => {
      const n = matrix[ri]![ci]!
      const tipText = `${author.name} · ${repoLabel(repo)}: ${n} commit${n === 1 ? '' : 's'}`
      const fill = n === 0 ? 'var(--empty)' : color(n)
      svg
        .append('rect')
        .attr('x', labelWHeat + ci * cellW + 4)
        .attr('y', y + 3)
        .attr('width', cellW - 8)
        .attr('height', cellH - 6)
        .attr('rx', 4)
        .attr('fill', fill)
        .attr('stroke', 'var(--empty-stroke)')
        .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
        .on('mouseleave', hideTip)

      if (n > 0) {
        svg
          .append('text')
          .attr('x', labelWHeat + ci * cellW + cellW / 2)
          .attr('y', y + cellH / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 11)
          .attr('font-weight', 600)
          .attr('fill', inkOn(fill))
          .text(String(n))
          .style('pointer-events', 'none')
      }
    })
  })
}

function drawGaps(container: d3.Selection<HTMLElement, unknown, null, undefined>, author: AuthorSummary) {
  container.selectAll('*').remove()
  const commits = commitsForAuthor(author)
  const active = new Set(commits.map((c) => periodOf(c.day)))
  const slots = data.weekdays
  const unit = grain === 'month' ? 'month' : 'weekday'

  const cellW = grain === 'month' ? 56 : Math.max(16, Math.min(28, 900 / Math.max(slots.length, 1)))
  const cellH = grain === 'month' ? 22 : 28
  const labelH = 20
  const width = 40 + slots.length * (cellW + 4)
  const height = labelH + cellH + 36

  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', width)
    .attr('height', height)
    .style('max-width', '100%')
    .style('height', 'auto')
    .attr('role', 'img')
    .attr('aria-label', `${grain === 'month' ? 'Month' : 'Weekday'} gaps for ${author.name}`)

  slots.forEach((day, i) => {
    const x = 8 + i * (cellW + 4)
    const has = active.has(day)
    const fill = has ? 'var(--accent)' : 'var(--gap-empty)'
    const tipText = has ? formatTooltip(day, commitsInPeriod(commits, day)) : `${periodAxisLabel(day)}: empty ${unit}`

    svg
      .append('rect')
      .attr('x', x)
      .attr('y', labelH)
      .attr('width', cellW)
      .attr('height', cellH)
      .attr('rx', 4)
      .attr('fill', fill)
      .attr('stroke', 'var(--empty-stroke)')
      .style('filter', has ? 'drop-shadow(0 0 4px var(--workspace-glow))' : 'none')
      .on('mousemove', (event: MouseEvent) => showTip(event, tipText))
      .on('mouseleave', hideTip)

    if (grain === 'month' || i % 2 === 0 || slots.length < 20) {
      svg
        .append('text')
        .attr('x', x + cellW / 2)
        .attr('y', labelH - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', grain === 'month' ? 12 : 11)
        .attr('fill', 'var(--muted)')
        .text(periodAxisLabel(day))
    }
  })

  const legend = container.append('div').attr('class', 'chart-legend')
  legend.append('span').attr('class', 'gap-active').text(`Active ${unit}`)
  legend.append('span').attr('class', 'gap-empty').text(`Empty ${unit}`)
}

function drawAuthorTable(container: d3.Selection<HTMLElement, unknown, null, undefined>) {
  container.selectAll('*').remove()
  const table = container.append('table')
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Author', 'Commits', 'Active days', 'Repos'])
    .join('th')
    .text((d) => d)

  const rows = table
    .append('tbody')
    .selectAll('tr')
    .data(data.authors)
    .join('tr')
    .classed('subject', (d) => d.isSubject)

  rows
    .selectAll('td')
    .data((d) => [d.name, String(d.commits), String(d.activeDays.length), d.repos.map((r) => repoLabel(r)).join(', ')])
    .join('td')
    .text((d) => d)
}

function currentTheme(): 'light' | 'dark' {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'light' ? 'light' : 'dark'
}

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('commit-visibility-theme', theme)
  } catch {
    // ignore quota / private mode
  }
  const btn = document.getElementById('theme-toggle')
  if (btn) {
    btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false')
    btn.textContent = theme === 'light' ? 'Dark theme' : 'Light theme'
  }
}

let hotspotMode: HotspotMode = 'files'
let churnScale: ChurnScale = 'log'

function selectedAuthor(): AuthorSummary {
  const chosen = document.getElementById('author') as HTMLSelectElement | null
  return data.authors.find((a) => a.emails.join('|') === chosen?.value) ?? data.authors.find((a) => a.isSubject)!
}

/** Wire a `.segmented` button group: keeps aria-pressed in sync and reports the chosen data-mode. */
function segmented(selector: string, onChange: (mode: string) => void) {
  const buttons = d3.selectAll<HTMLButtonElement, unknown>(`${selector} button`)
  buttons.on('click', function () {
    const mode = this.dataset.mode ?? ''
    buttons.attr('aria-pressed', function () {
      return String(this.dataset.mode === mode)
    })
    onChange(mode)
  })
}

function render(authorKey: string) {
  const author = data.authors.find((a) => a.emails.join('|') === authorKey) ?? data.authors.find((a) => a.isSubject)!
  const unit = grain === 'month' ? 'months' : 'weekdays'
  const unitSingular = grain === 'month' ? 'month' : 'weekday'

  d3.select('#stack-title').text(grain === 'month' ? 'Commits by month and repo' : 'Commits by day and repo')
  d3.select('#bars-title').text(grain === 'month' ? 'Monthly commit volume' : 'Weekday commit volume')
  d3.select('#gaps-title').text(grain === 'month' ? 'Month gaps' : 'Weekday gaps')
  d3.select('#gaps-hint').text(`One cell per ${unitSingular} in the window.`)
  d3.select('#weekend-legend').style('display', grain === 'month' ? 'none' : null)
  d3.select('#weekend-empty-legend').style('display', grain === 'month' ? 'none' : null)
  d3.select('#workspace-legend').text(
    grain === 'month' ? 'Workspace = any repo that month' : 'Workspace = any repo that day',
  )

  d3.select('#subtitle').text(`${data.window.start} → ${data.window.end} · ${author.name}`)
  d3.select('#churn-title').text(
    grain === 'month' ? 'Lines added and deleted by month' : 'Lines added and deleted by day',
  )

  drawKpis(d3.select('#kpis'), author)
  drawLanes(d3.select('#lanes'), author)
  drawBarChart(d3.select('#bars'), author)
  drawStack(d3.select('#stack'), author)
  drawChurn(d3.select('#churn'), author, churnScale)
  drawTypes(d3.select('#types'), author)
  drawSizes(d3.select('#sizes'), author)
  drawPunchcard(d3.select('#punchcard'), author)
  drawHotspots(d3.select('#hotspots'), author, hotspotMode)
  drawBranches(d3.select('#branches'), author)
  drawCollab(d3.select('#collab'), author)
  drawGaps(d3.select('#gaps'), author)
  if (data.github) {
    drawPullRequests(d3.select('#prs'), author)
    drawReviews(d3.select('#reviews'), author)
    drawCi(d3.select('#ci'), author)
  }

  const commits = commitsForAuthor(author)
  const active = data.weekdays.filter((d) => commits.some((c) => periodOf(c.day) === d))
  const empty = data.weekdays.length - active.length
  d3.select('#summary').html(
    `<strong>${active.length}</strong> of <strong>${data.weekdays.length}</strong> ${unit} active · <strong>${empty}</strong> empty · <strong>${commits.length}</strong> commits`,
  )
}

function main() {
  setTheme(currentTheme())

  const themeBtn = document.getElementById('theme-toggle')
  themeBtn?.addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light'
    setTheme(next)
    const select = document.getElementById('author') as HTMLSelectElement | null
    if (select) render(select.value)
    // Heatmap bakes resolved RGB from theme tokens; redraw with the new palette.
    drawHeatmap(d3.select('#heatmap'))
  })

  const select = d3.select('#author') as d3.Selection<HTMLSelectElement, unknown, null, undefined>
  select
    .selectAll('option')
    .data(data.authors)
    .join('option')
    .attr('value', (d) => d.emails.join('|'))
    .text((d) => d.name)

  select.on('change', function (this: HTMLSelectElement) {
    render(this.value)
  })

  drawAuthorTable(d3.select('#authors'))
  drawHeatmap(d3.select('#heatmap'))

  segmented('#hotspots-mode', (mode) => {
    hotspotMode = mode === 'folders' ? 'folders' : 'files'
    drawHotspots(d3.select('#hotspots'), selectedAuthor(), hotspotMode)
  })
  segmented('#churn-scale', (mode) => {
    churnScale = mode === 'linear' ? 'linear' : 'log'
    drawChurn(d3.select('#churn'), selectedAuthor(), churnScale)
  })

  const pngBtn = document.getElementById('export-png') as HTMLButtonElement | null
  pngBtn?.addEventListener('click', async () => {
    pngBtn.disabled = true
    pngBtn.textContent = 'Exporting…'
    try {
      await exportPng(['commit-visibility', data.window.label, selectedAuthor().name])
    } catch (err) {
      console.error('PNG export failed', err)
    } finally {
      pngBtn.disabled = false
      pngBtn.textContent = 'Export PNG'
    }
  })
  document.getElementById('export-pdf')?.addEventListener('click', () => window.print())
  // Heatmap bakes resolved theme colors; repaint it whenever print swaps the theme.
  setupPrintTheme(() => drawHeatmap(d3.select('#heatmap')))

  const subject = data.authors.find((a) => a.isSubject)!
  const subjectKey = subject.emails.join('|')
  select.property('value', subjectKey)
  render(subjectKey)

  if (grain === 'month') {
    const lanesEl = document.getElementById('lanes')
    if (lanesEl) {
      new ResizeObserver(() => {
        drawLanes(d3.select('#lanes'), selectedAuthor())
      }).observe(lanesEl)
    }
  }
}

main()
