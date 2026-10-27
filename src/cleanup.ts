import type { BranchPr, BranchTip, CleanupBranch, CleanupReason } from './types.ts'

/** Unmerged branches with no PR and no commit for this many days are suggested, not marked safe. */
export const ABANDONED_AFTER_DAYS = 30

const DAY_MS = 86_400_000

/** Branch names teams usually keep around even when they hold nothing unmerged. */
const LONG_LIVED =
  /^(dev|develop|development|staging|stage|prod|production|release|releases|qa|test|uat|preview|gh-pages)$/i

/**
 * Decide which of the subject's branches can be deleted. Pure: git state
 * comes in on `tips`, PR state on `prs`, and `today` is YYYY-MM-DD.
 *
 * A branch is only "safe" when every copy (local and remote) is covered: no
 * commits left off base, patch-equivalent ones only, or nothing newer than
 * the PR that merged or closed it. Branches with an open PR are in flight
 * and never listed.
 */
export function classifyCleanup(tips: BranchTip[], prs: BranchPr[], today: string): CleanupBranch[] {
  const rows: CleanupBranch[] = []
  for (const tip of tips) {
    if (tip.copies.length === 0) continue
    const lastIso = tip.copies.reduce((a, c) => (Date.parse(c.iso) > Date.parse(a) ? c.iso : a), tip.copies[0]!.iso)
    const branchPrs = prs
      .filter((p) => p.repo === tip.repo && p.headRef === tip.name)
      .sort((a, b) => b.number - a.number)
    if (branchPrs.some((p) => p.state === 'OPEN')) continue
    const pr = branchPrs[0] ?? null

    let reason: CleanupReason | null = null
    if (tip.copies.every((c) => c.ahead === 0)) reason = 'merged'
    else if (tip.copies.every((c) => c.ahead === 0 || c.patchMerged)) reason = 'patch-merged'
    else if (pr) {
      const until = pr.state === 'MERGED' ? pr.mergedIso : pr.closedIso
      const covered = until !== null && tip.copies.every((c) => Date.parse(c.iso) <= Date.parse(until))
      if (covered) reason = pr.state === 'MERGED' ? 'squash-merged' : 'pr-closed'
    }
    if (!reason) {
      const quietDays = (Date.parse(`${today}T12:00:00Z`) - Date.parse(lastIso)) / DAY_MS
      if (!pr && quietDays > ABANDONED_AFTER_DAYS) reason = 'abandoned'
    }
    if (!reason) continue

    const { copies, ...rest } = tip
    rows.push({
      ...rest,
      local: copies.some((c) => c.remote === null),
      remotes: [...new Set(copies.flatMap((c) => (c.remote ? [c.remote] : [])))],
      reason,
      longLived: LONG_LIVED.test(tip.name),
      lastIso,
      pr: pr ? { number: pr.number, url: pr.url, mergedIso: pr.mergedIso, closedIso: pr.closedIso } : null,
    })
  }
  return rows.sort((a, b) => (Date.parse(a.lastIso) < Date.parse(b.lastIso) ? 1 : -1))
}

/** Safe to delete; abandoned and long-lived branches are only suggestions. */
export function isSafeCleanup(branch: CleanupBranch): boolean {
  return branch.reason !== 'abandoned' && !branch.longLived
}

/**
 * Shell lines that delete a branch everywhere it still exists. Local deletes
 * use -D except for fully merged branches, because squash- and
 * rebase-merged branches look unmerged to `git branch -d`. Abandoned
 * branches come out commented, so they need an explicit opt-in.
 */
export function cleanupCommands(branch: CleanupBranch): string[] {
  const lines: string[] = []
  const prefix = isSafeCleanup(branch) ? '' : '# '
  const flag = branch.reason === 'merged' ? '-d' : '-D'
  if (branch.local) {
    lines.push(
      branch.current
        ? `# ${branch.name} is checked out in ${branch.path}; switch branches before deleting it`
        : `${prefix}git -C ${shellQuote(branch.path)} branch ${flag} ${shellQuote(branch.name)}`,
    )
  }
  for (const remote of branch.remotes) {
    lines.push(`${prefix}git -C ${shellQuote(branch.path)} push ${remote} --delete ${shellQuote(branch.name)}`)
  }
  return lines
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}
