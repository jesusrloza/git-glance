import { describe, expect, test } from 'bun:test'
import { classifyCleanup, cleanupCommands } from './cleanup.ts'
import type { BranchCopy, BranchPr, BranchTip } from './types.ts'

const copy = (partial: Partial<BranchCopy> = {}): BranchCopy => ({
  ref: 'feat/x',
  remote: null,
  iso: '2026-10-10T10:00:00Z',
  ahead: 0,
  patchMerged: false,
  ...partial,
})

const tip = (name: string, copies: BranchCopy[], current = false): BranchTip => ({
  repo: 'alpha',
  path: '/work/alpha',
  name,
  base: 'origin/main',
  current,
  copies,
})

const pr = (headRef: string, partial: Partial<BranchPr>): BranchPr => ({
  repo: 'alpha',
  number: 1,
  url: 'https://github.com/o/alpha/pull/1',
  headRef,
  state: 'MERGED',
  mergedIso: null,
  closedIso: null,
  ...partial,
})

const today = '2026-10-27'

describe('classifyCleanup', () => {
  test('merged when every copy is on base; local and remotes collapse', () => {
    const [row] = classifyCleanup([tip('a', [copy(), copy({ ref: 'origin/a', remote: 'origin' })])], [], today)
    expect(row).toMatchObject({ name: 'a', reason: 'merged', local: true, remotes: ['origin'], pr: null })
  })

  test('patch-merged when leftover commits are patch-identical to base', () => {
    const rows = classifyCleanup([tip('b', [copy({ ahead: 2, patchMerged: true })])], [], today)
    expect(rows[0]!.reason).toBe('patch-merged')
  })

  test('squash-merged only when no copy has commits after the merge', () => {
    const merged = pr('c', { mergedIso: '2026-10-12T00:00:00Z', closedIso: '2026-10-12T00:00:00Z' })
    expect(classifyCleanup([tip('c', [copy({ ahead: 3 })])], [merged], today)[0]!.reason).toBe('squash-merged')
    // A local commit after the merge is unpushed work: not listed (it is recent, so not abandoned either).
    const later = copy({ ahead: 4, iso: '2026-10-20T00:00:00Z' })
    expect(classifyCleanup([tip('c', [copy({ ahead: 3 }), later])], [merged], today)).toEqual([])
  })

  test('pr-closed when the newest PR was closed unmerged', () => {
    const closed = pr('d', { state: 'CLOSED', closedIso: '2026-10-15T00:00:00Z' })
    expect(classifyCleanup([tip('d', [copy({ ahead: 1 })])], [closed], today)[0]!.reason).toBe('pr-closed')
  })

  test('an open PR keeps the branch off the list', () => {
    const open = pr('e', { number: 2, state: 'OPEN' })
    expect(classifyCleanup([tip('e', [copy()])], [open], today)).toEqual([])
  })

  test('abandoned only without a PR and after 30 quiet days', () => {
    const old = copy({ ahead: 5, iso: '2026-09-01T00:00:00Z' })
    const recent = copy({ ahead: 5, iso: '2026-10-20T00:00:00Z' })
    expect(classifyCleanup([tip('f', [old])], [], today)[0]!.reason).toBe('abandoned')
    expect(classifyCleanup([tip('f', [recent])], [], today)).toEqual([])
  })
})

describe('cleanupCommands', () => {
  const [merged] = classifyCleanup([tip('a', [copy(), copy({ ref: 'origin/a', remote: 'origin' })])], [], today)
  const [abandoned] = classifyCleanup([tip('it’s old', [copy({ ahead: 1, iso: '2026-01-01T00:00:00Z' })])], [], today)
  const [current] = classifyCleanup([tip('g', [copy()], true)], [], today)

  test('safe-delete for merged branches, local and remote', () => {
    expect(cleanupCommands(merged!)).toEqual([
      'git -C /work/alpha branch -d a',
      'git -C /work/alpha push origin --delete a',
    ])
  })

  test('abandoned branches come out commented and quoted', () => {
    expect(cleanupCommands(abandoned!)).toEqual(["# git -C /work/alpha branch -D 'it’s old'"])
  })

  test('long-lived names stay commented even when merged', () => {
    const [dev] = classifyCleanup([tip('dev', [copy()])], [], today)
    expect(dev!.longLived).toBe(true)
    expect(cleanupCommands(dev!)).toEqual(['# git -C /work/alpha branch -d dev'])
  })

  test('a checked-out branch gets a note instead of a delete', () => {
    expect(cleanupCommands(current!)[0]).toStartWith('# g is checked out')
  })
})
