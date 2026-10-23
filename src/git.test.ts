import { describe, expect, test } from 'bun:test'
import { commitType, sizeBucket } from './commit-kinds.ts'
import { excluder, parseLog, renamedPath } from './git.ts'
import { calendarMonth, customRange, lastNDays, previousWindow } from './window.ts'

const RS = '\x1e'

describe('parseLog', () => {
  const text = [
    `${RS}aaa\t2026-10-13T10:00:00-06:00\tMe\tMe@Example.com\tfeat(api): add\tthing\n`,
    '10\t2\tsrc/a.ts\n',
    '-\t-\tlogo.png\n',
    '500\t0\tbun.lock\n',
    '3\t1\tsrc/{old => new}/b.ts\n',
    `${RS}bbb\t2026-10-14T09:00:00-06:00\tMe\tme@example.com\tMerge branch 'x'\n`,
  ].join('')

  const commits = parseLog(text, 'alpha', excluder(['db.json']))

  test('sums numstat lines, skips default noise, keeps binaries as 0/0', () => {
    const [first] = commits
    expect(first!.subject).toBe('feat(api): add\tthing')
    expect(first!.authorEmail).toBe('me@example.com')
    expect(first!.files.map((f) => f.path)).toEqual(['src/a.ts', 'logo.png', 'src/new/b.ts'])
    expect(first!.added).toBe(13)
    expect(first!.deleted).toBe(3)
  })

  test('commit without numstat (merge) has empty stats', () => {
    expect(commits[1]!.files).toEqual([])
    expect(commits[1]!.added).toBe(0)
  })

  test('configured excludes apply on top of defaults', () => {
    const c = parseLog(`${RS}h\t2026-10-13T10:00:00Z\tMe\tme@x\ts\n9\t9\tdb.json\n`, 'alpha', excluder(['db.json']))
    expect(c[0]!.files).toEqual([])
  })
})

describe('renamedPath', () => {
  test('resolves brace and plain renames to the new path', () => {
    expect(renamedPath('src/{old => new}/x.ts')).toBe('src/new/x.ts')
    expect(renamedPath('src/{ => lib}/x.ts')).toBe('src/lib/x.ts')
    expect(renamedPath('{ => src}/x.ts')).toBe('src/x.ts')
    expect(renamedPath('a.ts => b.ts')).toBe('b.ts')
    expect(renamedPath('plain.ts')).toBe('plain.ts')
  })
})

describe('commit kinds', () => {
  test('conventional prefixes, aliases, merges, fallback', () => {
    expect(commitType('feat(ui)!: big change')).toBe('feat')
    expect(commitType('ci: cache deps')).toBe('build')
    expect(commitType('Merge pull request #4 from x/y')).toBe('merge')
    expect(commitType('my-repo#80: keep secrets out')).toBe('other')
    expect(commitType('Fix: typo')).toBe('fix')
  })

  test('size buckets by lines changed', () => {
    expect(sizeBucket(0)).toBe('XS')
    expect(sizeBucket(10)).toBe('XS')
    expect(sizeBucket(11)).toBe('S')
    expect(sizeBucket(801)).toBe('XL')
  })
})

describe('previousWindow', () => {
  test('same-length range right before a day window', () => {
    const prev = previousWindow(lastNDays(30, '2026-10-15'))!
    expect(prev.start).toBe('2026-08-17')
    expect(prev.end).toBe('2026-09-15')
  })

  test('previous calendar month for a month window', () => {
    const prev = previousWindow(calendarMonth('2026-03'))!
    expect([prev.start, prev.end]).toEqual(['2026-02-01', '2026-02-28'])
  })

  test('custom range and all-time', () => {
    expect(previousWindow(customRange('2026-09-08', '2026-09-14'))).toMatchObject({
      start: '2026-09-01',
      end: '2026-09-07',
    })
    expect(previousWindow({ start: '2026-01-01', end: '2026-10-15', label: 'all-time', grain: 'month' })).toBeNull()
  })
})
