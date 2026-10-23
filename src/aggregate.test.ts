import { describe, expect, test } from 'bun:test'
import { aggregate } from './aggregate.ts'
import type { Commit, ReportConfig } from './types.ts'
import { allTimeWindow, customRange } from './window.ts'

const config: ReportConfig = {
  subjectEmails: ['me@example.com', 'me-noreply@users.noreply.github.com'],
  subjectLogins: [],
  collections: [],
  github: false,
  repos: [
    { name: 'alpha', path: '/tmp/alpha', label: 'alpha' },
    { name: 'beta', path: '/tmp/beta', label: 'beta' },
  ],
  excludePaths: [],
}

function c(
  partial: Omit<Commit, 'authorName' | 'authorEmail' | 'added' | 'deleted' | 'files'> & {
    email?: string
    name?: string
  },
): Commit {
  return {
    hash: partial.hash,
    iso: partial.iso,
    day: partial.day,
    authorName: partial.name ?? 'Me',
    authorEmail: (partial.email ?? 'me@example.com').toLowerCase(),
    subject: partial.subject,
    repo: partial.repo,
    added: 0,
    deleted: 0,
    files: [],
  }
}

describe('aggregate', () => {
  test('workspace mark is union of repos; weekend does not fill weekday gaps', () => {
    const window = customRange('2026-09-01', '2026-09-07')
    const commits: Commit[] = [
      c({
        hash: 'a1',
        iso: '2026-09-02T10:00:00-06:00',
        day: '2026-09-02',
        subject: 'alpha work',
        repo: 'alpha',
      }),
      c({
        hash: 'b1',
        iso: '2026-09-04T10:00:00-06:00',
        day: '2026-09-04',
        subject: 'beta work',
        repo: 'beta',
      }),
      c({
        hash: 's1',
        iso: '2026-09-06T10:00:00-06:00',
        day: '2026-09-06',
        subject: 'sunday',
        repo: 'alpha',
      }),
    ]

    const data = aggregate(commits, config, window)
    expect(data.grain).toBe('day')
    expect(data.workspaceMarks['2026-09-02']).toBe('committed')
    expect(data.workspaceMarks['2026-09-04']).toBe('committed')
    expect(data.workspaceMarks['2026-09-01']).toBe('empty')
    expect(data.workspaceMarks['2026-09-03']).toBe('empty')
    expect(data.workspaceMarks['2026-09-06']).toBe('committed')

    const emptyDays = data.emptyWeekdays.map((e) => e.day)
    expect(emptyDays).toContain('2026-09-01')
    expect(emptyDays).toContain('2026-09-03')
    expect(emptyDays).not.toContain('2026-09-06')

    const alpha = data.repoSummaries.find((r) => r.repo === 'alpha')!
    expect(alpha.quietWhileActive).toContain('2026-09-04')
  })

  test('merges both subject emails; empty weekdays have no others payload', () => {
    const window = customRange('2026-09-01', '2026-09-03')
    const commits: Commit[] = [
      c({
        hash: 'm1',
        iso: '2026-09-02T09:00:00-06:00',
        day: '2026-09-02',
        subject: 'mine',
        repo: 'alpha',
        email: 'me-noreply@users.noreply.github.com',
      }),
      c({
        hash: 'o1',
        iso: '2026-09-01T09:00:00-06:00',
        day: '2026-09-01',
        subject: 'theirs',
        repo: 'alpha',
        email: 'other@example.com',
        name: 'Other Dev',
      }),
      c({
        hash: 'o2',
        iso: '2026-09-01T10:00:00-06:00',
        day: '2026-09-01',
        subject: 'theirs 2',
        repo: 'alpha',
        email: 'other@example.com',
        name: 'Other Dev',
      }),
    ]

    const data = aggregate(commits, config, window)
    expect(data.subjectCommits).toHaveLength(1)
    expect(data.workspaceMarks['2026-09-02']).toBe('committed')

    const empty = data.emptyWeekdays.find((e) => e.day === '2026-09-01')!
    expect(empty).toBeDefined()
    expect(empty.weekday).toBe('Tuesday')

    const others = data.authors.filter((a) => !a.isSubject)
    expect(others[0]!.name).toBe('Other Dev')
    expect(others[0]!.commits).toBe(2)
  })

  test('month grain marks periods by YYYY-MM', () => {
    const window = allTimeWindow('2026-01-15', '2026-03-10')
    expect(window.grain).toBe('month')
    expect(window.start).toBe('2026-01-01')

    const commits: Commit[] = [
      c({
        hash: 'j1',
        iso: '2026-01-20T10:00:00-06:00',
        day: '2026-01-20',
        subject: 'jan',
        repo: 'alpha',
      }),
      c({
        hash: 'm1',
        iso: '2026-03-05T10:00:00-06:00',
        day: '2026-03-05',
        subject: 'mar',
        repo: 'beta',
      }),
    ]

    const data = aggregate(commits, config, window)
    expect(data.days).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(data.workspaceMarks['2026-01']).toBe('committed')
    expect(data.workspaceMarks['2026-02']).toBe('empty')
    expect(data.workspaceMarks['2026-03']).toBe('committed')
    expect(data.emptyWeekdays.map((e) => e.day)).toEqual(['2026-02'])
  })
})
