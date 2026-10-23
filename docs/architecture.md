# Architecture

git-glance is a small Bun CLI that turns `git log` across configured repos
(collections of checkouts and individual paths) into a subject-focused
visibility report (markdown + interactive HTML), with optional GitHub data from
`gh`.

Stack: Bun (runtime, package manager, tests, and the local static server),
TypeScript, D3 for the dashboard in `src/html/report.ts`, and Biome for lint
and format. The main data source is local git history; `gh` adds PRs, reviews
and CI runs when it is installed, logged in and not turned off.

## Pipeline

```text
config JSON
    → loadConfig (collections scanned for .git children, minus excludes,
                  + explicit repos → RepoRef[], deduped by path)
    → optional git fetch --all --prune
    → githubStatus (config toggle / --no-github, gh on PATH, gh api user)
    → per repo, in parallel:
        git log --all --numstat (window, and the previous window for deltas)
        git for-each-ref + git log base..branch (unmerged branches)
        git for-each-ref refs/tags (tags in the window)
        when gh is ok: gh pr list, gh run list, gh api …/commits (login ↔ email)
    → aggregate (subject vs others, calendars, summaries, repoLabels)
    → render markdown + HTML under out/<window>/
```

The **subject** is whoever matches `subjectEmails`. Their commits drive the
workspace calendar, empty-weekday gaps, per-repo lanes, and handoff bullets.
Everyone else’s commits stay in the dataset for comparison (empty-day “who
committed instead”, author table, share charts) and do not fill the subject’s
calendar.

Reports never write into the scanned work trees. Fetch updates remotes only.

## Source layout

| Path | Role |
|------|------|
| `src/config.ts` | Project root, default/example config paths, `--config` parsing, path resolution (`~`, relative, absolute), collection discovery, repo resolution |
| `src/types.ts` | Shared types (`Commit`, `RepoRef`, `ReportConfig`, `ReportData`, …) |
| `src/repo-palette.ts` | Index → light/dark hex for `--repo-N` CSS variables |
| `src/window.ts` | Date helpers and window builders (last 30d, month, last-month, all-time) |
| `src/window-args.ts` | Shared CLI flags for the date window |
| `src/resolve-window.ts` | Resolves `--all-time` via earliest commit across repos |
| `src/git.ts` | `isGitRepo`, remotes, fetch, `git log --numstat` → `Commit[]` (with noise excludes), unmerged branches, tags, email lookback |
| `src/github.ts` | `gh` availability, remote URL → `owner/name`, PR / run / commit-login loading and their pure parsers |
| `src/commit-kinds.ts` | Pure classifiers shared by markdown and dashboard: Conventional Commit type, size bucket |
| `src/aggregate.ts` | Pure transform: commits + config + window → `ReportData` (day or month grain) |
| `src/insights.ts` | Short factual prose for handoff and empty days |
| `src/render/markdown.ts` | Markdown report text (uses `repoLabels` for display) |
| `src/render/html.ts` | HTML shell; injects index colors; embeds report data + dashboard script |
| `src/html/common.ts` | Dashboard payload type and shared helpers (colors, tooltip, axes) |
| `src/html/report.ts` | Client-side D3 dashboard entry: lanes, commit charts, author picker, wiring |
| `src/html/insights.ts` | KPI tiles, churn, commit types/sizes, punchcard, hotspots, work in flight, collaboration |
| `src/html/github.ts` | GitHub cards (pull requests, reviews given, CI health), PR cell for Work in flight, author → login matching |
| `src/html/export.ts` | PNG export (html-to-image) and light theme while printing |
| `src/cli.ts` | `bun run report` |
| `src/fetch.ts` | `bun run fetch` |
| `src/doctor.ts` | `bun run doctor` |
| `src/authors.ts` | `bun run authors` |
| `src/preview.ts` | Serve an existing `out/<window>/` |
| `src/view.ts` | Report, then preview (forwards flags including `--config`) |

Entry scripts stay thin: parse flags, load config, call git/aggregate/render.

## Config model

On disk:

- `collections` — folders whose `.git` children are repos, with `exclude` and `labels`
- `repos` — `{ path, label?, github? }` or a path string
- paths are absolute, `~/…`, or relative to the project root

After `loadConfig`, each entry is a `RepoRef`:

- `path` — absolute work-tree path used for every git command
- `name` — folder basename used as `Commit.repo` (identity / grouping)
- `label` — short display name on legends and calendars

Chart colors are assigned by index in the resolved repo order
(`--repo-0`, `--repo-1`, …), not by folder name. Same config order ⇒ same
colors across every generated window.

## Outputs

For a window label such as `last-30d` or `2026-09`:

```text
out/<window>/
  commit-visibility.md
  commit-visibility.html
  index.html          # same content as the HTML report
```

The HTML report is self-contained (D3 and html-to-image are bundled in). Theme
toggle and author comparison live in `src/html/report.ts`.

Everything the dashboard draws is computed in the browser from the embedded
commits (each carries `added`, `deleted` and `files`), so switching author
re-derives every card without regenerating the report. The previous window's
commits ship without file lists; they only feed the Overview deltas.

**`view`** runs the report, then serves `out/<label>/` with `Bun.serve` on
`127.0.0.1:4173` (another port if 4173 is taken) and prints the URL. It does
not open a browser. **`preview`** only serves an existing folder
(`bun run preview --month 2026-09`, `bun run preview --all-time`).

Windows: default last 30 days, `--month YYYY-MM`, `--last-month`, `--all-time`
(month grain on lanes/charts). Gap cards show active vs empty for the selected
author only.

## Design notes

- **Same-machine, multi-workspace**: one gitignored live config by default;
  `--config` with another collection path when clients change.
- **Collections over lists**: point at a folder of checkouts and exclude what
  you don't want, so new clones show up without editing the config.
- **Aggregation stays pure**: tests feed synthetic commits into `aggregate`
  without touching the filesystem.
- **Git first, GitHub optional**: reports read `git log` / `git for-each-ref`
  (and `git fetch` when asked). GitHub data goes through `gh`, so this project
  never handles tokens. A missing or logged-out `gh`, a non-GitHub remote, or a
  failed `gh` call only drops GitHub data (with a console line and a note on
  the dashboard); it never fails the report.
- **GitHub identity**: authors are keyed by email; GitHub uses logins. The
  commits API gives login ↔ email pairs, noreply addresses carry the login, and
  the logged-in `gh` user is always the subject. `gh pr list --json commits`
  is not used: its nested authors exceed GitHub's GraphQL node limit.
- **CI attribution**: `gh run list` has no actor field, so a run counts for an
  author when its `headSha` is one of their commits or its branch is the head
  of one of their PRs.
- **Cheap extra git calls**: `--numstat` adds roughly 0.1 s per repo on a few
  hundred commits; branch checks are two `git` calls per branch that moved in
  the window. A full report stays well under a second on the default repos.
