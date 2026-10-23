import { $ } from 'bun'
import { resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { BranchInfo, Commit, DateWindow, FileChange, RepoRef, TagInfo } from './types.ts'

/**
 * Calendar day from an ISO-8601 author date with offset.
 * Uses the date shown in the offset-local wall clock (the YYYY-MM-DD before T).
 */
export function dayFromIso(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(iso)
  if (!m) throw new Error(`Unexpected ISO date: ${iso}`)
  return m[1]!
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false
  const check = await $`git -C ${dir} rev-parse --is-inside-work-tree`.quiet().nothrow()
  return check.exitCode === 0
}

export async function listRemotes(dir: string): Promise<string[]> {
  const result = await $`git -C ${dir} remote`.quiet().nothrow()
  if (result.exitCode !== 0) return []
  return result.stdout
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Age of FETCH_HEAD in ms, or null if missing / unreadable. */
export function fetchHeadAgeMs(dir: string): number | null {
  const pathResult = Bun.spawnSync(['git', '-C', dir, 'rev-parse', '--git-path', 'FETCH_HEAD'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (pathResult.exitCode !== 0) return null
  const rel = pathResult.stdout.toString().trim()
  if (!rel) return null
  const abs = resolve(dir, rel)
  if (!existsSync(abs)) return null
  try {
    const mtime = statSync(abs).mtimeMs
    return Date.now() - mtime
  } catch {
    return null
  }
}

export type FetchReposResult = {
  ok: string[]
  failed: string[]
}

export async function fetchRepos(repos: RepoRef[]): Promise<FetchReposResult> {
  const ok: string[] = []
  const failed: string[] = []

  for (const repo of repos) {
    if (!(await isGitRepo(repo.path))) {
      console.error(`✗ ${repo.name}: not a git repo (${repo.path})`)
      failed.push(repo.name)
      continue
    }

    console.log(`→ fetching ${repo.name}…`)
    const result = await $`git -C ${repo.path} fetch --all --prune`.nothrow()
    if (result.exitCode !== 0) {
      const err = result.stderr.toString().trim() || result.stdout.toString().trim()
      console.error(`✗ ${repo.name}: ${err || `exit ${result.exitCode}`}`)
      failed.push(repo.name)
      continue
    }
    console.log(`✓ ${repo.name}`)
    ok.push(repo.name)
  }

  return { ok, failed }
}

/** Earliest author-date calendar day across repos, or null if none. */
export async function earliestCommitDay(repos: RepoRef[]): Promise<string | null> {
  let earliest: string | null = null
  for (const repo of repos) {
    if (!(await isGitRepo(repo.path))) continue
    // Newest-first log; last line is the oldest. Avoid `log -n 1 --reverse`,
    // which selects one commit then reverses it (still the newest).
    const result = await $`git -C ${repo.path} log --all --format=%aI`.quiet().nothrow()
    if (result.exitCode !== 0) continue
    const lines = result.stdout
      .toString()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) continue
    const iso = lines[lines.length - 1]!
    const day = dayFromIso(iso)
    if (earliest === null || day < earliest) earliest = day
  }
  return earliest
}

/** Lock files, build output and snapshots skew line counts; always left out of stats. */
export const DEFAULT_EXCLUDE_PATHS = [
  '**/bun.lock',
  '**/bun.lockb',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/go.sum',
  '**/poetry.lock',
  '**/composer.lock',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/dist/**',
  '**/build/**',
  '**/node_modules/**',
]

export type LoadCommitsOptions = {
  /** Read `--numstat` into `added`, `deleted` and `files`. */
  stats?: boolean
  /** Extra globs on top of DEFAULT_EXCLUDE_PATHS. */
  excludePaths?: string[]
}

/**
 * Resolve git's rename notation to the new path:
 * `src/{old => new}/x.ts` → `src/new/x.ts`, `old.ts => new.ts` → `new.ts`.
 */
export function renamedPath(path: string): string {
  const braced = path
    .replace(/\{[^{}]* => ([^{}]*)\}/g, '$1')
    .replace(/\/\/+/g, '/')
    .replace(/^\//, '')
  if (braced !== path) return braced
  const arrow = path.indexOf(' => ')
  return arrow >= 0 ? path.slice(arrow + 4) : path
}

export function excluder(patterns: string[]): (path: string) => boolean {
  const globs = [...DEFAULT_EXCLUDE_PATHS, ...patterns].map((p) => new Bun.Glob(p))
  return (path) => globs.some((g) => g.match(path))
}

const RECORD = '\x1e'

/** Parse `git log --format=<RS>%H…%s [--numstat]` output. */
export function parseLog(text: string, repo: string, isExcluded: (path: string) => boolean): Commit[] {
  const commits: Commit[] = []
  for (const record of text.split(RECORD)) {
    if (!record.trim()) continue
    const [header, ...statLines] = record.split('\n')
    const parts = header!.split('\t')
    if (parts.length < 5) continue
    const [hash, iso, authorName, authorEmail, ...subjectParts] = parts
    if (!hash || !iso || !authorName || !authorEmail) continue

    const files: FileChange[] = []
    for (const line of statLines) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
      if (!m) continue
      const path = renamedPath(m[3]!)
      if (isExcluded(path)) continue
      files.push({
        path,
        added: m[1] === '-' ? 0 : Number(m[1]),
        deleted: m[2] === '-' ? 0 : Number(m[2]),
      })
    }

    commits.push({
      hash,
      iso,
      day: dayFromIso(iso),
      authorName,
      authorEmail: authorEmail.toLowerCase(),
      subject: subjectParts.join('\t'),
      repo,
      added: files.reduce((n, f) => n + f.added, 0),
      deleted: files.reduce((n, f) => n + f.deleted, 0),
      files,
    })
  }
  return commits
}

export async function loadCommits(repo: RepoRef, window: DateWindow, opts: LoadCommitsOptions = {}): Promise<Commit[]> {
  if (!(await isGitRepo(repo.path))) {
    throw new Error(`Not a git repo: ${repo.path}`)
  }

  // --until is exclusive in git for date-only forms in some versions; use end+1 day
  // with a time so the inclusive end day is fully included.
  const until = `${window.end} 23:59:59`
  const format = '%x1e%H%x09%aI%x09%an%x09%ae%x09%s'
  const stats = opts.stats ? ['--numstat'] : []

  const result =
    window.label === 'all-time'
      ? await $`git -c core.quotePath=false -C ${repo.path} log --all --until=${until} --format=${format} ${stats}`
          .quiet()
          .nothrow()
      : await $`git -c core.quotePath=false -C ${repo.path} log --all --since=${`${window.start} 00:00:00`} --until=${until} --format=${format} ${stats}`
          .quiet()
          .nothrow()

  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim()
    throw new Error(`git log failed in ${repo.name}: ${err || result.exitCode}`)
  }

  return parseLog(result.stdout.toString(), repo.name, excluder(opts.excludePaths ?? []))
}

export async function loadAllCommits(
  repos: RepoRef[],
  window: DateWindow,
  opts: LoadCommitsOptions = {},
): Promise<Commit[]> {
  const perRepo = await Promise.all(repos.map((repo) => loadCommits(repo, window, opts)))
  const all = perRepo.flat()
  all.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  return all
}

async function lines(cmd: ReturnType<typeof $>): Promise<string[] | null> {
  const result = await cmd.quiet().nothrow()
  if (result.exitCode !== 0) return null
  return result.stdout
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** origin/HEAD target, else the first of origin/main, origin/master, main, master that exists. */
export async function defaultBranch(dir: string): Promise<string | null> {
  const head = await lines($`git -C ${dir} symbolic-ref --short refs/remotes/origin/HEAD`)
  if (head?.[0]) return head[0]
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const ok = await lines($`git -C ${dir} rev-parse --verify --quiet ${`${candidate}^{commit}`}`)
    if (ok?.length) return candidate
  }
  return null
}

/**
 * Branches (local or remote) whose tip moved since `window.start` and that hold
 * commits not on the default branch. Local and remote copies of the same branch
 * collapse to whichever tip is newer.
 */
export async function loadBranches(repo: RepoRef, window: DateWindow): Promise<BranchInfo[]> {
  if (!(await isGitRepo(repo.path))) return []
  const base = await defaultBranch(repo.path)
  if (!base) return []
  const baseShort = base.replace(/^[^/]+\//, '')

  const refs = await lines(
    $`git -C ${repo.path} for-each-ref --format=${'%(refname)%09%(refname:short)%09%(committerdate:iso-strict)'} refs/heads refs/remotes`,
  )
  if (!refs) return []

  const newest = new Map<string, { ref: string; iso: string }>()
  for (const line of refs) {
    const [full, short, iso] = line.split('\t')
    if (!full || !short || !iso) continue
    if (full.endsWith('/HEAD')) continue
    const name = full.startsWith('refs/remotes/') ? short.replace(/^[^/]+\//, '') : short
    if (name === baseShort || short === base) continue
    if (window.label !== 'all-time' && dayFromIso(iso) < window.start) continue
    const prior = newest.get(name)
    if (!prior || iso > prior.iso) newest.set(name, { ref: short, iso })
  }

  const branches = await Promise.all(
    [...newest].map(async ([name, { ref, iso }]): Promise<BranchInfo | null> => {
      const emails = await lines($`git -C ${repo.path} log --no-merges --format=%ae ${`${base}..${ref}`}`)
      if (!emails || emails.length === 0) return null
      const behind = await lines($`git -C ${repo.path} rev-list --count ${`${ref}..${base}`}`)
      const authors: Record<string, number> = {}
      for (const e of emails) {
        const key = e.toLowerCase()
        authors[key] = (authors[key] ?? 0) + 1
      }
      return {
        repo: repo.name,
        name,
        ref,
        base,
        lastIso: iso,
        ahead: emails.length,
        behind: Number(behind?.[0] ?? 0),
        authors,
      }
    }),
  )
  return branches.filter((b): b is BranchInfo => b !== null).sort((a, b) => (a.lastIso < b.lastIso ? 1 : -1))
}

/** Tags whose creator date falls inside the window. */
export async function loadTags(repo: RepoRef, window: DateWindow): Promise<TagInfo[]> {
  if (!(await isGitRepo(repo.path))) return []
  const rows = await lines(
    $`git -C ${repo.path} for-each-ref --format=${'%(refname:short)%09%(creatordate:iso-strict)'} refs/tags`,
  )
  if (!rows) return []
  const tags: TagInfo[] = []
  for (const row of rows) {
    const [name, iso] = row.split('\t')
    if (!name || !iso) continue
    const day = dayFromIso(iso)
    if (day > window.end || (window.label !== 'all-time' && day < window.start)) continue
    tags.push({ repo: repo.name, name, iso, day })
  }
  return tags.sort((a, b) => (a.iso < b.iso ? -1 : 1))
}

/** True if any commit in the last `sinceDays` matches the author email (case-insensitive). */
export async function emailHasCommits(repos: RepoRef[], email: string, sinceDays: number): Promise<boolean> {
  const needle = email.toLowerCase()
  const since = `${sinceDays} days ago`
  for (const repo of repos) {
    if (!(await isGitRepo(repo.path))) continue
    const result = await $`git -C ${repo.path} log --all --since=${since} --author=${needle} --format=%ae -n 1`
      .quiet()
      .nothrow()
    if (result.exitCode !== 0) continue
    const hit = result.stdout.toString().trim().toLowerCase()
    if (hit) return true
  }
  return false
}
