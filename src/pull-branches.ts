import { $ } from 'bun'

export type BranchState = {
  /** Commits on the local branch that its upstream lacks. */
  ahead: number
  /** Commits on the upstream that the local branch lacks. */
  behind: number
  /** The branch is checked out in this work tree. */
  current: boolean
  /** This work tree has uncommitted changes to tracked files. */
  dirty: boolean
  /** The upstream branch was deleted on the remote. */
  upstreamGone: boolean
  /** The branch is checked out in another linked work tree. */
  otherWorktree: boolean
}

export type BranchAction =
  | 'up-to-date'
  | 'fast-forward'
  | 'ahead'
  | 'diverged'
  | 'dirty'
  | 'upstream-gone'
  | 'other-worktree'

/** Decide what to do with one branch. Only a branch that is purely behind moves. */
export function planBranch(s: BranchState): BranchAction {
  if (s.upstreamGone) return 'upstream-gone'
  if (s.ahead > 0 && s.behind > 0) return 'diverged'
  if (s.ahead > 0) return 'ahead'
  if (s.behind === 0) return 'up-to-date'
  if (s.otherWorktree) return 'other-worktree'
  if (s.current && s.dirty) return 'dirty'
  return 'fast-forward'
}

export type BranchResult = {
  branch: string
  action: BranchAction
  ahead: number
  behind: number
  /** Set when a fast-forward was attempted and git refused it. */
  error?: string
}

async function text(cmd: ReturnType<typeof $>): Promise<string> {
  return (await cmd.quiet()).stdout.toString().trim()
}

/**
 * Fast-forward every local branch that tracks an upstream and is only behind it.
 * Uses refs already fetched (run `git fetch` first). Never merges, rebases,
 * resets or touches a branch with local commits or a dirty checkout.
 */
export async function pullRepo(dir: string): Promise<BranchResult[]> {
  const current = await text($`git -C ${dir} branch --show-current`)
  const dirty = (await text($`git -C ${dir} status --porcelain --untracked-files=no`)) !== ''
  const worktrees = await text($`git -C ${dir} worktree list --porcelain`)
  const top = await text($`git -C ${dir} rev-parse --show-toplevel`)
  const elsewhere = new Set<string>()
  let path = ''
  for (const line of worktrees.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line.startsWith('branch refs/heads/') && path !== top)
      elsewhere.add(line.slice('branch refs/heads/'.length))
  }

  const refs = await text(
    $`git -C ${dir} for-each-ref --format=${'%(refname:short)%09%(objectname)%09%(upstream)%09%(upstream:track)'} refs/heads`,
  )
  const results: BranchResult[] = []
  for (const line of refs.split('\n').filter(Boolean)) {
    const [branch = '', sha = '', upstream = '', track = ''] = line.split('\t')
    if (!upstream) continue
    const upstreamGone = track === '[gone]'
    let ahead = 0
    let behind = 0
    if (!upstreamGone) {
      const counts = await text($`git -C ${dir} rev-list --left-right --count ${`refs/heads/${branch}...${upstream}`}`)
      const [a = '0', b = '0'] = counts.split(/\s+/)
      ahead = Number(a)
      behind = Number(b)
    }
    const action = planBranch({
      ahead,
      behind,
      current: branch === current,
      dirty,
      upstreamGone,
      otherWorktree: elsewhere.has(branch),
    })
    const result: BranchResult = { branch, action, ahead, behind }
    if (action === 'fast-forward') {
      const run =
        branch === current
          ? await $`git -C ${dir} merge --ff-only --quiet ${upstream}`.quiet().nothrow()
          : await $`git -C ${dir} update-ref ${`refs/heads/${branch}`} ${upstream} ${sha}`.quiet().nothrow()
      if (run.exitCode !== 0) result.error = run.stderr.toString().trim() || `exit ${run.exitCode}`
    }
    results.push(result)
  }
  return results
}
