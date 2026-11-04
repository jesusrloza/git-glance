import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planBranch, pullRepo } from './pull-branches.ts'

describe('planBranch', () => {
  const base = { ahead: 0, behind: 0, current: false, dirty: false, upstreamGone: false, otherWorktree: false }

  test('nothing to do when not behind', () => {
    expect(planBranch(base)).toBe('up-to-date')
  })

  test('fast-forwards a branch that is only behind', () => {
    expect(planBranch({ ...base, behind: 3 })).toBe('fast-forward')
    expect(planBranch({ ...base, behind: 3, current: true })).toBe('fast-forward')
  })

  test('never touches local work', () => {
    expect(planBranch({ ...base, ahead: 1 })).toBe('ahead')
    expect(planBranch({ ...base, ahead: 1, behind: 2 })).toBe('diverged')
    expect(planBranch({ ...base, behind: 2, current: true, dirty: true })).toBe('dirty')
    expect(planBranch({ ...base, behind: 2, otherWorktree: true })).toBe('other-worktree')
  })

  test('reports a branch whose upstream was deleted', () => {
    expect(planBranch({ ...base, upstreamGone: true })).toBe('upstream-gone')
  })
})

describe('pullRepo (real git)', () => {
  let dir: string
  let origin: string
  let clone: string

  const git = (cwd: string) => (args: string[]) => $`git -C ${cwd} ${args}`.quiet()
  const commit = async (cwd: string, file: string) => {
    writeFileSync(join(cwd, file), file)
    await git(cwd)(['add', file])
    await git(cwd)(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file])
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'glance-pull-'))
    origin = join(dir, 'origin.git')
    const seed = join(dir, 'seed')
    clone = join(dir, 'clone')
    await $`git init -q --bare -b main ${origin}`.quiet()
    await $`git init -q -b main ${seed}`.quiet()
    await commit(seed, 'a')
    await git(seed)(['checkout', '-qb', 'feature'])
    await commit(seed, 'f1')
    await git(seed)(['checkout', '-q', 'main'])
    await git(seed)(['remote', 'add', 'origin', origin])
    await git(seed)(['push', '-q', 'origin', 'main', 'feature'])
    await $`git clone -q ${origin} ${clone}`.quiet()
    await git(clone)(['branch', '-q', '--track', 'feature', 'origin/feature'])
    await git(clone)(['checkout', '-qb', 'mine', '--track', 'origin/main'])
    await commit(clone, 'mine-only')
    await git(clone)(['checkout', '-q', 'main'])
    // Origin moves ahead on main and feature.
    await commit(seed, 'b')
    await git(seed)(['checkout', '-q', 'feature'])
    await commit(seed, 'f2')
    await git(seed)(['push', '-q', 'origin', 'main', 'feature'])
    await git(clone)(['fetch', '-q', 'origin'])
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('fast-forwards the current and other branches, leaves local work alone', async () => {
    const before = (await git(clone)(['rev-parse', 'mine'])).stdout.toString().trim()
    const result = await pullRepo(clone)
    const byName = Object.fromEntries(result.map((r) => [r.branch, r]))
    expect(byName.main!.action).toBe('fast-forward')
    expect(byName.feature!.action).toBe('fast-forward')
    expect(byName.mine!.action).toBe('diverged')
    for (const b of ['main', 'feature']) {
      const local = (await git(clone)(['rev-parse', b])).stdout.toString().trim()
      const remote = (await git(clone)(['rev-parse', `origin/${b}`])).stdout.toString().trim()
      expect(local).toBe(remote)
    }
    expect((await git(clone)(['rev-parse', 'mine'])).stdout.toString().trim()).toBe(before)
    expect((await git(clone)(['status', '--porcelain'])).stdout.toString()).toBe('')
  })

  test('a second run has nothing to do', async () => {
    const result = await pullRepo(clone)
    expect(result.find((r) => r.branch === 'main')!.action).toBe('up-to-date')
    expect(result.find((r) => r.branch === 'feature')!.action).toBe('up-to-date')
  })
})
