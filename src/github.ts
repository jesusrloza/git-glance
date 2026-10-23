import { $ } from 'bun'
import { isoInWindow } from './window.ts'
import type { DateWindow, GithubData, PrReview, PullRequestInfo, RepoRef, WorkflowRunInfo } from './types.ts'

export type GithubState = 'ok' | 'disabled' | 'missing' | 'unauthenticated'

export type GithubStatus = { state: GithubState; login: string | null }

/** Why GitHub cards are absent, in a sentence for the console and dashboard. */
export function githubStateNote(state: GithubState): string | null {
  switch (state) {
    case 'ok':
      return null
    case 'disabled':
      return 'GitHub cards are off ("github": false in the config, or --no-github).'
    case 'missing':
      return 'GitHub cards skipped: gh is not installed (https://cli.github.com).'
    case 'unauthenticated':
      return 'GitHub cards skipped: gh is not logged in (run gh auth login).'
  }
}

/**
 * Whether `gh` can be used. Never throws: a missing binary or a logged-out
 * session just means a git-only report.
 */
export async function githubStatus(enabled: boolean): Promise<GithubStatus> {
  if (!enabled) return { state: 'disabled', login: null }
  if (!Bun.which('gh')) return { state: 'missing', login: null }
  const user = await $`gh api user --jq .login`.quiet().nothrow()
  const login = user.stdout.toString().trim()
  if (user.exitCode !== 0 || !login) return { state: 'unauthenticated', login: null }
  return { state: 'ok', login }
}

/** `owner/name` from a github.com remote URL (ssh, scp-like or https), else null. */
export function parseRemoteUrl(url: string): string | null {
  const m =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    )
  return m ? `${m[1]}/${m[2]}` : null
}

/** GitHub slug for a repo: the config override, else its origin remote. */
export async function repoSlug(repo: RepoRef): Promise<string | null> {
  if (repo.github) return repo.github
  const result = await $`git -C ${repo.path} remote get-url origin`.quiet().nothrow()
  if (result.exitCode !== 0) return null
  return parseRemoteUrl(result.stdout.toString())
}

/** Login encoded in a GitHub noreply address (`123+login@…` or `login@…`), else null. */
export function noreplyLogin(email: string): string | null {
  const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email.trim())
  return m ? m[1]!.toLowerCase() : null
}

type RawCheck = { __typename?: string; conclusion?: string | null; status?: string; state?: string }

/** Collapse a PR's statusCheckRollup to one state. */
export function rollupChecks(checks: RawCheck[] | null | undefined): PullRequestInfo['checks'] {
  if (!checks || checks.length === 0) return 'none'
  let pending = false
  for (const c of checks) {
    const result = (c.__typename === 'StatusContext' ? c.state : c.conclusion) ?? ''
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result)) {
      return 'failure'
    }
    if (!result || result === 'PENDING' || result === 'EXPECTED') pending = true
  }
  return pending ? 'pending' : 'success'
}

type RawPr = {
  number: number
  title: string
  url: string
  state: PullRequestInfo['state']
  isDraft: boolean
  author: { login: string } | null
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  headRefName: string
  baseRefName: string
  reviewDecision: string | null
  reviews: { author: { login: string } | null; state: PrReview['state']; submittedAt: string }[] | null
  statusCheckRollup: RawCheck[] | null
}

/**
 * `gh pr list --json …` output → PRs with any activity in the window (opened,
 * merged, closed or reviewed). Review bodies are dropped.
 */
export function parsePrList(text: string, repo: string, window: DateWindow): PullRequestInfo[] {
  const raw = JSON.parse(text) as RawPr[]
  const prs: PullRequestInfo[] = []
  for (const p of raw) {
    const reviews: PrReview[] = (p.reviews ?? [])
      .filter((r) => r.author?.login && r.submittedAt)
      .map((r) => ({ login: r.author!.login.toLowerCase(), state: r.state, iso: r.submittedAt }))
    const active =
      isoInWindow(p.createdAt, window) ||
      isoInWindow(p.mergedAt, window) ||
      isoInWindow(p.closedAt, window) ||
      reviews.some((r) => isoInWindow(r.iso, window))
    if (!active) continue
    prs.push({
      repo,
      number: p.number,
      title: p.title,
      url: p.url,
      state: p.state,
      isDraft: p.isDraft,
      author: (p.author?.login ?? 'ghost').toLowerCase(),
      createdIso: p.createdAt,
      mergedIso: p.mergedAt,
      closedIso: p.closedAt,
      headRef: p.headRefName,
      baseRef: p.baseRefName,
      reviewDecision: p.reviewDecision ?? '',
      reviews,
      checks: rollupChecks(p.statusCheckRollup),
    })
  }
  return prs.sort((a, b) => (a.createdIso < b.createdIso ? 1 : -1))
}

type RawRun = {
  databaseId: number
  workflowName: string
  headSha: string
  headBranch: string
  event: string
  conclusion: string
  status: string
  createdAt: string
  url: string
}

export function parseRunList(text: string, repo: string): WorkflowRunInfo[] {
  return (JSON.parse(text) as RawRun[]).map((r) => ({
    repo,
    id: r.databaseId,
    workflow: r.workflowName,
    headSha: r.headSha,
    headBranch: r.headBranch,
    event: r.event,
    conclusion: r.conclusion,
    status: r.status,
    iso: r.createdAt,
    url: r.url,
  }))
}

/** `sha \t login \t email` lines from the commits API → login → emails. */
export function parseCommitLogins(text: string, into: Map<string, Set<string>>) {
  for (const line of text.split('\n')) {
    const [, login, email] = line.split('\t')
    if (!login || !email) continue
    const key = login.toLowerCase()
    let set = into.get(key)
    if (!set) {
      set = new Set()
      into.set(key, set)
    }
    set.add(email.trim().toLowerCase())
  }
}

const PR_FIELDS =
  'number,title,url,state,isDraft,author,createdAt,mergedAt,closedAt,headRefName,baseRefName,reviewDecision,reviews,statusCheckRollup'
const RUN_FIELDS = 'databaseId,workflowName,headSha,headBranch,event,conclusion,status,createdAt,url'

async function ghText(cmd: ReturnType<typeof $>, what: string): Promise<string | null> {
  const result = await cmd.quiet().nothrow()
  if (result.exitCode === 0) return result.stdout.toString()
  const err = result.stderr.toString().trim().split('\n')[0]
  console.warn(`⚠ gh: ${what} failed${err ? `: ${err}` : ''}`)
  return null
}

/**
 * PRs, workflow runs and commit logins for every repo that lives on GitHub.
 * Failures warn and leave that repo's data empty; they never fail the report.
 */
export async function loadGithub(
  repos: RepoRef[],
  window: DateWindow,
  login: string,
  subjectLogins: string[],
  subjectEmails: string[],
): Promise<GithubData> {
  const allTime = window.label === 'all-time'
  const loginEmails = new Map<string, Set<string>>()
  const slugs: Record<string, string> = {}
  const prs: PullRequestInfo[] = []
  const runs: WorkflowRunInfo[] = []

  await Promise.all(
    repos.map(async (repo) => {
      const slug = await repoSlug(repo)
      if (!slug) return
      slugs[repo.name] = slug
      const prSearch = allTime ? [] : ['--search', `updated:>=${window.start}`]
      const runCreated = allTime ? [] : ['--created', `${window.start}..${window.end}`]
      const since = allTime ? '' : `&since=${window.start}T00:00:00Z`
      const commitsUrl = `repos/${slug}/commits?per_page=100${since}&until=${window.end}T23:59:59Z`
      const [prText, runText, commitText] = await Promise.all([
        ghText($`gh pr list -R ${slug} --state all --limit 1000 ${prSearch} --json ${PR_FIELDS}`, `PRs for ${slug}`),
        ghText($`gh run list -R ${slug} --limit 1000 ${runCreated} --json ${RUN_FIELDS}`, `runs for ${slug}`),
        ghText(
          $`gh api --paginate ${commitsUrl} --jq ${'.[] | [.sha, (.author.login // ""), .commit.author.email] | @tsv'}`,
          `commit authors for ${slug}`,
        ),
      ])
      if (prText) prs.push(...parsePrList(prText, repo.name, window))
      if (runText) runs.push(...parseRunList(runText, repo.name).filter((r) => isoInWindow(r.iso, window)))
      if (commitText) parseCommitLogins(commitText, loginEmails)
    }),
  )

  const subject = [...new Set([login, ...subjectLogins].map((l) => l.toLowerCase()))]
  for (const email of subjectEmails) {
    const fromNoreply = noreplyLogin(email)
    if (fromNoreply && !subject.includes(fromNoreply)) subject.push(fromNoreply)
  }

  return {
    login: login.toLowerCase(),
    subjectLogins: subject,
    prs: prs.sort((a, b) => (a.createdIso < b.createdIso ? 1 : -1)),
    runs: runs.sort((a, b) => (a.iso < b.iso ? 1 : -1)),
    loginEmails: Object.fromEntries([...loginEmails].map(([l, set]) => [l, [...set].sort()])),
    slugs,
  }
}
