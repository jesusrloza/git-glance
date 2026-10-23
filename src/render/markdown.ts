import type { ReportData } from '../types.ts'
import {
  formatDayFull,
  formatDayLong,
  formatDayShort,
  formatMonthLong,
  formatMonthShort,
  isWeekend,
  monthKey,
  parseDay,
  weekdayIndex,
  weekdayName,
} from '../window.ts'
import { isSubjectEmail, shortHash } from '../aggregate.ts'
import { COMMIT_TYPES, commitType } from '../commit-kinds.ts'

function mark(m: 'committed' | 'empty'): string {
  return m === 'committed' ? '●' : '·'
}

function repoLabel(data: ReportData, repo: string): string {
  return data.repoLabels[repo] ?? repo
}

function padLabel(label: string, width: number): string {
  return label.padEnd(width)
}

/** Fixed-width day column (4 chars) so headers and marks share the same grid. */
const CAL_COL = 4
const CAL_LABEL = 8 // "Sep 01" + padding

function calHeader(text: string): string {
  return text.padStart(CAL_COL)
}

function calMark(ch: string): string {
  // Center-ish in a 4-char slot: "  ● ", "  · ", "  - ", "  ○ "
  return `  ${ch} `
}

/** Workspace calendar block (Mon–Sun weeks), columns aligned under headers. */
function renderWorkspaceCalendar(data: ReportData): string {
  const byWeek = new Map<string, string[]>()
  for (const day of data.days) {
    const d = parseDay(day)
    const dow = d.getUTCDay()
    const offset = dow === 0 ? -6 : 1 - dow
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() + offset)
    const key = monday.toISOString().slice(0, 10)
    let list = byWeek.get(key)
    if (!list) {
      list = []
      byWeek.set(key, list)
    }
    list.push(day)
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(calHeader).join('')
  const weekend = ['Sat', 'Sun'].map(calHeader).join('')
  const header = `${''.padEnd(CAL_LABEL)}${weekdays} |${weekend}`

  const lines: string[] = ['```', header]
  for (const [monday, daysInWeek] of byWeek) {
    const dayByDow = new Map<number, string>()
    for (const day of daysInWeek) {
      dayByDow.set(weekdayIndex(day), day)
    }
    const labelDay = daysInWeek.includes(monday) ? monday : daysInWeek[0]!
    const ld = parseDay(labelDay)
    const label = `${monthNames[ld.getUTCMonth()]} ${String(ld.getUTCDate()).padStart(2, '0')}`.padEnd(CAL_LABEL)

    const cell = (dow: number): string => {
      const day = dayByDow.get(dow)
      if (!day) return ''.padStart(CAL_COL)
      const committed = data.workspaceMarks[day] === 'committed'
      if (isWeekend(day)) return calMark(committed ? '○' : '-')
      return calMark(committed ? '●' : '·')
    }

    lines.push(`${label}${cell(1)}${cell(2)}${cell(3)}${cell(4)}${cell(5)} |${cell(6)}${cell(0)}`)
  }
  lines.push('```')
  return lines.join('\n')
}

function commitCountInPeriod(data: ReportData, period: string): number {
  if (data.grain === 'month') {
    return data.subjectCommits.filter((c) => monthKey(c.day) === period).length
  }
  return data.subjectCommits.filter((c) => c.day === period).length
}

function renderWeekdayBarChart(data: ReportData): string {
  const periods = data.weekdays
  const labels = periods.map((period, i) => {
    if (data.grain === 'month') return `"${formatMonthShort(period)}"`
    const d = parseDay(period)
    if (i === 0 || d.getUTCDate() === 1) {
      return `"${formatDayShort(period, { forceMonth: true })}"`
    }
    return `"${d.getUTCDate()}"`
  })
  const counts = periods.map((period) => commitCountInPeriod(data, period))
  const max = Math.max(7, ...counts, 1)

  return [
    '```mermaid',
    'xychart-beta',
    `    title "Commits on each ${data.grain === 'month' ? 'month' : 'weekday'}"`,
    `    x-axis [${labels.join(', ')}]`,
    `    y-axis "Commits" 0 --> ${max}`,
    `    bar [${counts.join(', ')}]`,
    '```',
  ].join('\n')
}

function renderMonthStrip(data: ReportData): string {
  const labelWidth = 12
  const col = 4
  const header = data.days.map((ym) => formatMonthShort(ym).slice(0, 3).padStart(col, ' ')).join('')
  const row = (label: string, marks: Record<string, 'committed' | 'empty'>) => {
    const cells = data.days.map((ym) => mark(marks[ym] ?? 'empty').padStart(col, ' ')).join('')
    return `${padLabel(label, labelWidth)}${cells}`
  }
  const lines = ['```', `${padLabel('', labelWidth)}${header}`, row('workspace', data.workspaceMarks)]
  for (const repo of data.repos) {
    lines.push(row(repoLabel(data, repo), data.repoMarks[repo]!))
  }
  lines.push('```')
  return lines.join('\n')
}

function renderRepoGrid(data: ReportData): string {
  if (data.grain === 'month') return renderMonthStrip(data)

  const days = data.weekdays
  const labelWidth = 12
  const col = 3 // " 1", " ●", " ·"

  const headerNums = days.map((day) => {
    const d = parseDay(day)
    return String(d.getUTCDate()).padStart(col, ' ')
  })

  const row = (label: string, marks: Record<string, 'committed' | 'empty'>) => {
    const cells = days.map((day) => mark(marks[day] ?? 'empty').padStart(col, ' ')).join('')
    return `${padLabel(label, labelWidth)}${cells}`
  }

  const lines = ['```', `${padLabel('', labelWidth)}${headerNums.join('')}`, row('workspace', data.workspaceMarks)]

  for (const repo of data.repos) {
    lines.push(row(repoLabel(data, repo), data.repoMarks[repo]!))
  }
  lines.push('```')
  return lines.join('\n')
}

function formatQuietDays(days: string[], grain: ReportData['grain']): string {
  if (days.length === 0) return '—'
  if (grain === 'month') {
    return days.map(formatMonthShort).join(', ')
  }
  // Group by month for compact display like "23, 25, 28, 29, 30 Sep, 5 Oct"
  const parts: string[] = []
  let i = 0
  while (i < days.length) {
    const day = days[i]!
    const d = parseDay(day)
    const month = d.getUTCMonth()
    const year = d.getUTCFullYear()
    const nums: number[] = []
    while (i < days.length) {
      const cur = parseDay(days[i]!)
      if (cur.getUTCMonth() !== month || cur.getUTCFullYear() !== year) break
      nums.push(cur.getUTCDate())
      i++
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    parts.push(`${nums.join(', ')} ${months[month]}`)
  }
  return parts.join(', ')
}

function formatCommitDaysCell(summary: {
  weekdayCount: number
  weekendDays: string[]
}): string {
  let s = String(summary.weekdayCount)
  for (const wd of summary.weekendDays) {
    s += `, plus ${weekdayNameShort(wd)} ${parseDay(wd).getUTCDate()} ${monthShort(wd)}`
  }
  return s
}

function weekdayNameShort(day: string): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseDay(day).getUTCDay()]!
}

function monthShort(day: string): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    parseDay(day).getUTCMonth()
  ]!
}

function inWindow(data: ReportData, iso: string | null): boolean {
  if (!iso) return false
  const day = iso.slice(0, 10)
  return day <= data.window.end && (data.window.label === 'all-time' || day >= data.window.start)
}

/** Subject's PRs, reviews and CI, when the report carries GitHub data. */
function githubLines(data: ReportData): string[] {
  const gh = data.github
  if (!gh) return data.githubNote ? ['## GitHub', '', data.githubNote, ''] : []
  const me = new Set(gh.subjectLogins)
  const lines: string[] = ['## GitHub', '']

  const prs = gh.prs.filter((p) => me.has(p.author))
  const opened = prs.filter((p) => inWindow(data, p.createdIso)).length
  const merged = prs.filter((p) => inWindow(data, p.mergedIso)).length
  const open = prs.filter((p) => p.state === 'OPEN').length
  lines.push(`- Pull requests: **${opened}** opened, **${merged}** merged, **${open}** still open.`)

  const reviews = gh.prs
    .filter((p) => !me.has(p.author))
    .flatMap((p) => p.reviews.filter((r) => me.has(r.login) && inWindow(data, r.iso)))
  const approved = reviews.filter((r) => r.state === 'APPROVED').length
  const changes = reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length
  lines.push(
    `- Reviews given: **${reviews.length}** (${approved} approved, ${changes} changes requested, ${reviews.length - approved - changes} other).`,
  )

  const hashes = new Set(data.subjectCommits.map((c) => c.hash))
  const branches = new Set(prs.map((p) => `${p.repo}\t${p.headRef}`))
  const finished = gh.runs.filter(
    (r) =>
      (hashes.has(r.headSha) || branches.has(`${r.repo}\t${r.headBranch}`)) &&
      r.status === 'completed' &&
      r.conclusion !== 'skipped' &&
      r.conclusion !== 'cancelled',
  )
  const passed = finished.filter((r) => r.conclusion === 'success').length
  lines.push(
    finished.length === 0
      ? '- CI: no finished workflow runs on your commits or PR branches.'
      : `- CI: **${passed}** of **${finished.length}** runs on your work passed (${Math.round((passed / finished.length) * 100)}%).`,
  )

  if (prs.length > 0) {
    lines.push('')
    lines.push('| Repo | PR | State | Opened |')
    lines.push('| --- | --- | --- | --- |')
    for (const p of prs) {
      const state = p.state === 'OPEN' && p.isDraft ? 'draft' : p.state.toLowerCase()
      lines.push(
        `| ${repoLabel(data, p.repo)} | [#${p.number}](${p.url}) ${p.title.replace(/\|/g, '\\|')} | ${state} | ${p.createdIso.slice(0, 10)} |`,
      )
    }
  }
  lines.push('')
  return lines
}

export function renderMarkdown(data: ReportData): string {
  const worked = data.weekdays.length - data.emptyWeekdays.length
  const empty = data.emptyWeekdays.length
  const repoList = data.repos.map((r) => `\`${r}\``).join(', ')
  const units = data.grain === 'month' ? 'months' : 'weekdays'

  const lines: string[] = []

  lines.push(
    `# Commit visibility, ${formatDayLong(data.window.start)}–${formatDayLong(data.window.end)} ${parseDay(data.window.end).getUTCFullYear()}`,
  )
  lines.push('')
  lines.push(`**Date:** ${formatDayFull(data.generatedOn)}`)
  lines.push(`**Scope:** Commits on every branch in ${repoList}.`)
  lines.push(`**Window:** ${formatDayFull(data.window.start)} through ${formatDayFull(data.window.end)}.`)
  lines.push('')
  const repoCount = data.repos.length
  const repoWord = repoCount === 1 ? 'repo' : 'repos'
  const emailList = data.subjectEmails.map((e) => `\`${e}\``)
  const emailPhrase =
    emailList.length === 1
      ? emailList[0]!
      : emailList.length === 2
        ? `${emailList[0]} and ${emailList[1]}`
        : `${emailList.slice(0, -1).join(', ')}, and ${emailList[emailList.length - 1]}`

  if (data.grain === 'month') {
    lines.push(
      `A month counts as a gap when none of the ${repoCount} configured ${repoWord} has a commit from you that month.`,
    )
  } else {
    lines.push(
      `A weekday counts as a gap when none of the ${repoCount} configured ${repoWord} has a commit from you. Saturday and Sunday are never gaps. A weekend commit is still listed.`,
    )
  }
  lines.push('')
  lines.push(
    `Your subject address${data.subjectEmails.length === 1 ? ' is' : 'es are'}: ${emailPhrase}. Other people's commits are left out of your calendar, and appear in the comparison section.`,
  )
  lines.push('')
  lines.push(data.grain === 'month' ? '## Month activity' : '## Workspace calendar')
  lines.push('')
  lines.push(
    `${data.weekdays.length} ${units} in the window. **${worked} have a commit from you. ${empty} are empty.**`,
  )
  lines.push('')
  if (data.grain === 'month') {
    lines.push(renderMonthStrip(data))
    lines.push('')
    lines.push('`●` is a month with at least one commit from you. `·` is an empty month.')
  } else {
    lines.push(renderWorkspaceCalendar(data))
    lines.push('')
    lines.push(
      '`●` is a weekday with at least one commit from you. `·` is an empty weekday. `○` is a weekend that has a commit. `-` is a weekend with none. The row label is the Monday of that week, except when the window starts mid-week.',
    )
  }
  lines.push('')
  lines.push(renderWeekdayBarChart(data))
  lines.push('')

  if (data.grain === 'day') {
    const weekendNote = data.weekendCommitDays
      .filter((w) => !data.weekdays.includes(w.day))
      .map(
        (w) =>
          `${w.weekday} ${formatDayLong(w.day)} has ${w.commits.length} commit${w.commits.length === 1 ? '' : 's'} and is not a gap.`,
      )
    if (weekendNote.length > 0) {
      lines.push(weekendNote.join(' '))
      lines.push('')
    }
  }

  lines.push(data.grain === 'month' ? '## Empty months' : '## Empty weekdays')
  lines.push('')
  if (data.emptyWeekdays.length === 0) {
    lines.push('None.')
  } else if (data.grain === 'month') {
    lines.push('| Month |')
    lines.push('| --- |')
    for (const e of data.emptyWeekdays) {
      lines.push(`| ${formatMonthLong(e.day)} |`)
    }
    lines.push('')
    if (data.longestEmptyStretch.length === 1) {
      lines.push(`The longest hole is a single month: ${formatMonthLong(data.longestEmptyStretch[0]!)}.`)
    } else if (data.longestEmptyStretch.length > 1) {
      lines.push(
        `The longest hole is ${data.longestEmptyStretch.map(formatMonthLong).join(' – ')} (${data.longestEmptyStretch.length} months).`,
      )
    }
  } else {
    lines.push('| Day | Date |')
    lines.push('| --- | --- |')
    for (const e of data.emptyWeekdays) {
      lines.push(`| ${e.weekday} | ${formatDayFull(e.day)} |`)
    }
    lines.push('')

    if (data.longestEmptyStretch.length > 0) {
      const stretch = data.longestEmptyStretch
      if (stretch.length === 1) {
        lines.push(`The longest hole is a single day: ${formatDayFull(stretch[0]!)}.`)
      } else {
        lines.push(
          `The longest hole inside a working stretch is ${stretch.map((d) => `${weekdayName(d)} ${formatDayLong(d)}`).join(' and ')}.`,
        )
      }
    }
  }
  lines.push('')

  if (data.grain === 'day' && data.weekendCommitDays.length > 0) {
    lines.push('## Weekend commits')
    lines.push('')
    for (const w of data.weekendCommitDays) {
      const byRepo = new Map<string, typeof w.commits>()
      for (const c of w.commits) {
        let list = byRepo.get(c.repo)
        if (!list) {
          list = []
          byRepo.set(c.repo, list)
        }
        list.push(c)
      }
      const bits = [...byRepo.entries()].map(([repo, commits]) => {
        const hashes = commits.map((c) => `\`${shortHash(c.hash)}\``).join(', ')
        const subjects = commits.map((c) => c.subject).join('; ')
        return `${commits.length} in \`${repo}\` (${hashes}: ${subjects})`
      })
      lines.push(
        `${w.weekday} ${formatDayFull(w.day)}, ${w.commits.length} commit${w.commits.length === 1 ? '' : 's'}: ${bits.join(' and ')}. Reported here. It does not fill weekday gaps before it.`,
      )
      lines.push('')
    }
  }

  lines.push('## Per repo')
  lines.push('')
  if (data.grain === 'month') {
    lines.push(
      'Active months below count months with at least one commit from you. "Quiet while another repo was active" means a month when that repo had nothing from you and at least one other repo did.',
    )
    lines.push('')
    lines.push('| Repo | Commits | Active months | Last commit | Quiet while another repo was active |')
  } else {
    lines.push(
      'Commit days below are weekdays, plus weekends where noted. "Quiet while another repo was active" means a weekday in this window when that repo had nothing from you and at least one other repo did.',
    )
    lines.push('')
    lines.push('| Repo | Commits | Weekdays with a commit | Last commit | Quiet while another repo was active |')
  }
  lines.push('| --- | ---: | --- | --- | --- |')
  for (const r of data.repoSummaries) {
    const last = r.lastCommitDay ? `${parseDay(r.lastCommitDay).getUTCDate()} ${monthShort(r.lastCommitDay)}` : '—'
    const activity = data.grain === 'month' ? String(r.weekdayCount) : formatCommitDaysCell(r)
    lines.push(
      `| ${r.repo} | ${r.commits} | ${activity} | ${last} | ${formatQuietDays(r.quietWhileActive, data.grain)} |`,
    )
  }
  lines.push('')
  lines.push(
    data.grain === 'month'
      ? 'Months in the window, one mark per repo. `●` is your commit. `·` is none.'
      : 'Weekdays in the window, one mark per repo. `●` is your commit. `·` is none.',
  )
  lines.push('')
  lines.push(renderRepoGrid(data))
  lines.push('')
  lines.push('### Repo activity')
  lines.push('')
  lines.push(data.handoff)
  lines.push('')
  lines.push(renderSubjectRepoBar(data))
  lines.push('')
  lines.push(...renderCodeSections(data))
  lines.push('## Gaps')
  lines.push('')
  lines.push(data.emptyDayInsight)
  lines.push('')
  lines.push('## Authors')
  lines.push('')
  if (data.authors.length === 0) {
    lines.push('No authors committed in this window.')
  } else {
    lines.push('| Author | Commits | Active days | Repos |')
    lines.push('| --- | ---: | ---: | --- |')
    for (const a of data.authors) {
      lines.push(`| ${a.name} | ${a.commits} | ${a.activeDays.length} | ${a.repos.map((r) => `\`${r}\``).join(', ')} |`)
    }
    lines.push('')
    lines.push(renderAuthorSharePie(data))
  }
  lines.push('')

  return lines.join('\n')
}

function renderSubjectRepoBar(data: ReportData): string {
  const rows = data.repoSummaries.filter((r) => r.commits > 0)
  if (rows.length === 0) return ''
  const labels = rows.map((r) => `"${repoLabel(data, r.repo)}"`)
  const values = rows.map((r) => r.commits)
  const max = Math.max(...values, 1)
  return [
    '```mermaid',
    'xychart-beta',
    '    title "Commits per repo"',
    `    x-axis [${labels.join(', ')}]`,
    `    y-axis "Commits" 0 --> ${max}`,
    `    bar [${values.join(', ')}]`,
    '```',
  ].join('\n')
}

function renderAuthorSharePie(data: ReportData): string {
  if (data.authors.length === 0) return ''
  const lines = ['```mermaid', 'pie showData', '    title Commit share in this window']
  for (const a of data.authors) {
    if (a.commits <= 0) continue
    // Mermaid pie labels: escape quotes
    const safe = a.name.replace(/"/g, "'")
    lines.push(`    "${safe}" : ${a.commits}`)
  }
  lines.push('```')
  return lines.join('\n')
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

/** Lines changed, commit types, unmerged branches and tags for the subject. */
function renderCodeSections(data: ReportData): string[] {
  const lines: string[] = []
  const mine = data.subjectCommits

  lines.push('## Code changes')
  lines.push('')
  if (mine.length === 0) {
    lines.push('No commits from you in this window.')
    lines.push('')
  } else {
    lines.push(
      'Lines from `git log --numstat`, merges and lock/build files excluded. Size is added + deleted lines per commit.',
    )
    lines.push('')
    lines.push('| Repo | Commits | Added | Deleted | Net | Median size |')
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
    const rows = data.repos
      .map((repo) => ({ repo, commits: mine.filter((c) => c.repo === repo) }))
      .filter((r) => r.commits.length > 0)
    for (const { repo, commits } of [...rows, { repo: 'Total', commits: mine }]) {
      const added = commits.reduce((n, c) => n + c.added, 0)
      const deleted = commits.reduce((n, c) => n + c.deleted, 0)
      const name = repo === 'Total' ? '**Total**' : repoLabel(data, repo)
      lines.push(
        `| ${name} | ${commits.length} | +${added} | -${deleted} | ${signed(added - deleted)} | ${median(commits.map((c) => c.added + c.deleted))} |`,
      )
    }
    lines.push('')

    const types = COMMIT_TYPES.map((t) => ({ t, n: mine.filter((c) => commitType(c.subject) === t).length })).filter(
      (r) => r.n > 0,
    )
    lines.push('### Commit types')
    lines.push('')
    lines.push(types.map((r) => `\`${r.t}\` ${r.n} (${Math.round((r.n / mine.length) * 100)}%)`).join(' · '))
    lines.push('')
  }

  const branches = data.branches.filter((b) =>
    Object.keys(b.authors).some((e) => isSubjectEmail(e, data.subjectEmails)),
  )
  lines.push('## Work in flight')
  lines.push('')
  if (branches.length === 0) {
    lines.push('No branches with unmerged commits from you that moved in this window.')
  } else {
    lines.push('Branches that moved in the window and still hold commits that are not on the default branch.')
    lines.push('')
    lines.push('| Repo | Branch | Your unmerged | Total unmerged | Behind base | Last commit |')
    lines.push('| --- | --- | ---: | ---: | ---: | --- |')
    for (const b of branches) {
      const yours = Object.entries(b.authors)
        .filter(([e]) => isSubjectEmail(e, data.subjectEmails))
        .reduce((n, [, k]) => n + k, 0)
      lines.push(
        `| ${repoLabel(data, b.repo)} | \`${b.name}\` | ${yours} | ${b.ahead} | ${b.behind} (\`${b.base}\`) | ${formatDayFull(b.lastIso.slice(0, 10))} |`,
      )
    }
  }
  lines.push('')

  lines.push(...githubLines(data))

  if (data.tags.length > 0) {
    lines.push('## Tags')
    lines.push('')
    for (const t of data.tags) {
      lines.push(`- ${formatDayFull(t.day)}: \`${t.name}\` in ${repoLabel(data, t.repo)}`)
    }
    lines.push('')
  }

  return lines
}
