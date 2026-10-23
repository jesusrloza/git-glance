/**
 * Pure commit classifiers shared by the markdown report and the dashboard bundle.
 */

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'build',
  'chore',
  'style',
  'merge',
  'other',
] as const

export type CommitType = (typeof COMMIT_TYPES)[number]

const ALIASES: Record<string, CommitType> = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  hotfix: 'fix',
  refactor: 'refactor',
  perf: 'perf',
  test: 'test',
  tests: 'test',
  docs: 'docs',
  doc: 'docs',
  build: 'build',
  ci: 'build',
  deps: 'build',
  chore: 'chore',
  style: 'style',
}

/** Conventional Commits prefix (`feat(scope)!: …`) → type; merges and the rest are separate buckets. */
export function commitType(subject: string): CommitType {
  if (/^Merge (branch|pull request|remote-tracking branch|tag)\b/.test(subject)) return 'merge'
  const m = /^(\w+)(\([^)]*\))?!?:/.exec(subject.trim())
  if (!m) return 'other'
  return ALIASES[m[1]!.toLowerCase()] ?? 'other'
}

export const SIZE_BUCKETS = [
  { key: 'XS', max: 10 },
  { key: 'S', max: 50 },
  { key: 'M', max: 200 },
  { key: 'L', max: 800 },
  { key: 'XL', max: Number.POSITIVE_INFINITY },
] as const

export type SizeBucket = (typeof SIZE_BUCKETS)[number]['key']

/** Bucket by lines changed (added + deleted). */
export function sizeBucket(linesChanged: number): SizeBucket {
  return SIZE_BUCKETS.find((b) => linesChanged <= b.max)!.key
}

export function sizeBucketLabel(key: SizeBucket): string {
  const i = SIZE_BUCKETS.findIndex((b) => b.key === key)
  const lo = i === 0 ? 0 : SIZE_BUCKETS[i - 1]!.max + 1
  const hi = SIZE_BUCKETS[i]!.max
  return Number.isFinite(hi) ? `${key} (${lo}–${hi})` : `${key} (${lo}+)`
}
