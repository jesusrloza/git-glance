/** One file in a commit's `--numstat` (noise paths already excluded). */
export type FileChange = {
  path: string
  /** Lines added; 0 for binary files. */
  added: number
  /** Lines deleted; 0 for binary files. */
  deleted: number
}

export type Commit = {
  hash: string
  /** Author date as ISO string with offset. */
  iso: string
  /** Calendar day YYYY-MM-DD from the author timestamp's local date. */
  day: string
  authorName: string
  authorEmail: string
  subject: string
  /** Folder basename of the configured repo path. */
  repo: string
  /** Sum of `files[].added`. */
  added: number
  /** Sum of `files[].deleted`. */
  deleted: number
  files: FileChange[]
}

/** Branch with commits not yet on the repo's default branch. */
export type BranchInfo = {
  repo: string
  /** Short name without the remote prefix, e.g. feat/login. */
  name: string
  /** Ref actually inspected, e.g. origin/feat/login. */
  ref: string
  /** Default branch it was compared against, e.g. origin/main. */
  base: string
  /** Commit date of the branch tip (ISO). */
  lastIso: string
  /** Unmerged commits (not on base, merges excluded). */
  ahead: number
  /** Commits on base that the branch does not have. */
  behind: number
  /** Unmerged commit count keyed by lower-cased author email. */
  authors: Record<string, number>
}

export type TagInfo = {
  repo: string
  name: string
  iso: string
  day: string
}

/** One git repo to scan, after path resolution. */
export type RepoRef = {
  /** Folder basename; identity for Commit.repo and grouping. */
  name: string
  /** Absolute path to the git work tree. */
  path: string
  /** Short display name on charts and calendars. */
  label: string
  /** GitHub `owner/name` override; otherwise derived from the origin remote. */
  github?: string
}

/** A folder scanned for repo checkouts, after discovery. */
export type CollectionInfo = {
  /** Absolute path of the collection folder. */
  path: string
  /** Repo names picked up from it, alphabetical. */
  repos: string[]
  /** Child folders left out, with why. */
  skipped: { name: string; reason: 'excluded' | 'not a git repo' }[]
}

export type ReportConfig = {
  subjectEmails: string[]
  /** GitHub logins that count as the subject, on top of the logged-in `gh` user. */
  subjectLogins: string[]
  repos: RepoRef[]
  collections: CollectionInfo[]
  /** Glob patterns (repo-relative) left out of line and file stats. */
  excludePaths: string[]
  /** Load GitHub data through `gh` when it is installed and logged in. */
  github: boolean
}

export type WindowGrain = 'day' | 'month'

export type DateWindow = {
  /** Inclusive start YYYY-MM-DD */
  start: string
  /** Inclusive end YYYY-MM-DD */
  end: string
  /** Short label used in output paths, e.g. 2026-09 or last-30d */
  label: string
  /** Day grain for short windows; month grain for all-time. */
  grain: WindowGrain
}

export type DayMark = 'committed' | 'empty'

/** Empty period for the subject (weekday YYYY-MM-DD or month YYYY-MM). */
export type EmptyWeekday = {
  day: string
  /** Weekday name when grain is day; empty string for month grain. */
  weekday: string
}

export type WeekendCommitDay = {
  day: string
  weekday: string
  commits: Commit[]
}

export type RepoSummary = {
  repo: string
  commits: number
  /** Days (any) with at least one subject commit. */
  commitDays: string[]
  /** Weekdays among those, plus weekend days noted separately in prose. */
  weekdayCount: number
  weekendDays: string[]
  lastCommitDay: string | null
  /** Periods this repo was quiet while another subject repo was active. */
  quietWhileActive: string[]
}

export type AuthorSummary = {
  name: string
  emails: string[]
  commits: number
  activeDays: string[]
  repos: string[]
  isSubject: boolean
}

export type ReportData = {
  generatedOn: string
  window: DateWindow
  /** Same as window.grain; duplicated for render convenience. */
  grain: WindowGrain
  subjectEmails: string[]
  /** Repo folder names in configured order. */
  repos: string[]
  /** Display labels keyed by repo folder name. */
  repoLabels: Record<string, string>
  /**
   * Period keys in the window: YYYY-MM-DD (day grain) or YYYY-MM (month grain).
   */
  days: string[]
  /**
   * Gap slots: weekdays (day grain) or all months (month grain).
   */
  weekdays: string[]
  subjectCommits: Commit[]
  allCommits: Commit[]
  /** period -> subject committed in that period (any repo) */
  workspaceMarks: Record<string, DayMark>
  /** repo -> period -> mark for subject */
  repoMarks: Record<string, Record<string, DayMark>>
  emptyWeekdays: EmptyWeekday[]
  longestEmptyStretch: string[]
  weekendCommitDays: WeekendCommitDay[]
  repoSummaries: RepoSummary[]
  authors: AuthorSummary[]
  handoff: string
  emptyDayInsight: string
  /** Window of the same length just before `window`; null for all-time. */
  previousWindow: DateWindow | null
  /** Every author's commits in `previousWindow` (for period-over-period deltas). */
  previousCommits: Commit[]
  /** Branches with unmerged work whose tip moved inside the window. */
  branches: BranchInfo[]
  /** Tags created inside the window. */
  tags: TagInfo[]
  /** PRs, reviews and CI runs from `gh`; null when GitHub data is off or unavailable. */
  github: GithubData | null
  /** Why `github` is null, for a note on the dashboard. */
  githubNote: string | null
}

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED'

export type PrReview = {
  /** GitHub login of the reviewer. */
  login: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  iso: string
}

export type PullRequestInfo = {
  repo: string
  number: number
  title: string
  url: string
  state: PrState
  isDraft: boolean
  /** GitHub login of the PR author. */
  author: string
  createdIso: string
  mergedIso: string | null
  closedIso: string | null
  headRef: string
  baseRef: string
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or empty. */
  reviewDecision: string
  reviews: PrReview[]
  /** Rollup of the head commit's checks. */
  checks: 'success' | 'failure' | 'pending' | 'none'
}

export type WorkflowRunInfo = {
  repo: string
  id: number
  workflow: string
  /** Commit the run built; matched to a git commit for attribution. */
  headSha: string
  headBranch: string
  event: string
  /** success, failure, cancelled, skipped, … or empty while running. */
  conclusion: string
  status: string
  iso: string
  url: string
}

export type GithubData = {
  /** Login of the `gh` user. */
  login: string
  /** Logins that count as the subject (gh login + subjectLogins). */
  subjectLogins: string[]
  prs: PullRequestInfo[]
  runs: WorkflowRunInfo[]
  /** Lower-cased commit emails seen per login (from PR commits and noreply addresses). */
  loginEmails: Record<string, string[]>
  /** `owner/name` per repo folder name, for links. */
  slugs: Record<string, string>
}
