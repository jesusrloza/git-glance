# git-glance

Local commit-visibility reports across any set of git repos. Point it at a
folder of checkouts (a *collection*, minus any you exclude), at individual repo
paths, or both. You choose which author emails count as you. The tool reads
`git log --all` for a date window (default: last 30 days) and writes a markdown
report plus an interactive HTML dashboard. It does not modify working trees.

When the [GitHub CLI](https://cli.github.com) is installed and logged in, the
report also adds pull request, review and CI cards. Without it you get the
git-only report.

## Prerequisites

[Bun](https://bun.sh) and git. Optional: `gh`, logged in with `gh auth login`.

## Create a report

```sh
bun install
cp config/report.config.example.json config/report.config.json
# edit subjectEmails and collections / repos in config/report.config.json
bun run view
```

A minimal config that scans every repo next to this checkout except the tool
itself:

```json
{
  "subjectEmails": ["you@example.com"],
  "collections": [{ "path": "..", "exclude": ["git-glance"] }]
}
```

`config/report.config.json` is gitignored. The example file stays in git as the
template. Field rules are in [docs/configuration.md](docs/configuration.md).

`bun run view` writes `out/last-30d/`:

- `commit-visibility.md`
- `commit-visibility.html`
- `index.html` (same as the HTML report)

It then serves that folder at `http://127.0.0.1:4173` and prints the URL. It
does not open a browser. If port 4173 is taken, it picks another port and
prints that URL. Stop the server with Ctrl+C.

If the report looks empty, run `bun run authors` and add any of your unmarked
emails to `subjectEmails`.

## What the dashboard shows

Every card follows the **Author** picker at the top.

| Card | What it answers |
|------|-----------------|
| Overview | Commits, active days, lines added/deleted, median commit size, repos touched, current/longest streak, each compared with the previous window of the same length |
| Repo lanes | Which repo had a commit on which day; weekends are circles |
| Commits by day and repo | Stacked commit counts; ◆ marks tags created that day |
| Lines added and deleted | Churn per day (or month) by repo; Log/Linear toggle |
| Weekday commit volume, gaps | Activity and empty weekdays |
| Commit types | Conventional Commit prefixes (`feat`, `fix`, …) per repo |
| Commit size | XS–XL histogram of lines changed per commit |
| Weekday × hour | When commits happen |
| Hotspots | Most-touched files or folders |
| Work in flight | Branches that moved in the window with commits not on the default branch |
| Collaboration | Share of changes per repo, and who else changed the same files |
| Authors × repos, Authors | Everyone in the window |

With `gh` available, these cards are added (also per selected author):

| Card | What it answers |
|------|-----------------|
| Pull requests | Opened, merged, closed unmerged and open PRs, median time to merge, and the list with state, review and checks |
| Reviews given | Reviews on other people's PRs per repo (approved / changes requested / commented), median time to first review |
| CI health | GitHub Actions pass rate on the author's commits and PR branches, latest failures |
| Work in flight | Gains a *Pull request* column: the branch's PR, its state, review decision and checks |

GitHub logins are matched to authors through the commit emails GitHub reports
and noreply addresses. For you, the logged-in `gh` user always counts. Turn the
cards off with `"github": false` in the config or `--no-github` on a run.

Line counts come from `git log --numstat`. Merges, lock files and build output
are skipped; add project-specific noise (seed data, generated code) with
`excludePaths` in the config.

**Export:** *Export PNG* saves the whole dashboard as an image. *Print / PDF*
opens the print dialog in the light theme; choose *Save as PDF*.

## Other windows

The same flags work on `bun run view` and `bun run report`.

| Flag | Output folder | Chart grain |
|------|---------------|-------------|
| (default) | `last-30d` | day |
| `--month YYYY-MM` | e.g. `2026-09` | day |
| `--last-month` | previous calendar month | day |
| `--all-time` | `all-time` | month |

```sh
bun run view --month 2026-09
bun run view --last-month
bun run view --all-time
```

## Tech stack

- **Bun** — runtime, package manager, test runner, and the local static server
- **TypeScript**
- **D3** — dashboard in the browser bundle from `src/html/report.ts`
- **Biome** — lint and format
- **git** — the main data source (`git log`, `for-each-ref`, and, when you ask, `git fetch`)
- **gh** (optional) — pull requests, reviews and workflow runs when installed and logged in
- **html-to-image** — PNG export, bundled into the report

How a report is built is in [docs/architecture.md](docs/architecture.md).
Planned work is in [docs/roadmap.md](docs/roadmap.md).

## Layout

- `docs/` — documentation for this project.
- `knowledge/` — notes about the repos you report on (`knowledge/tmp/` is gitignored for private working notes).
- `out/` — generated reports (gitignored).

## Commands

### Report

Writes the files under `out/<window>/` and does not start a server.

```sh
bun run report
bun run report --fetch
bun run report --month 2026-09
bun run report --last-month
bun run report --all-time
bun run report --fetch --last-month
bun run report --no-github
bun run report -- --config path/to/report.config.json
```

`--fetch` runs `git fetch --all --prune` in each configured repo before the
report. `--no-github` skips the GitHub cards for this run. Pass `--` before `--config` so Bun forwards the flag to the script.

### Preview

Serves an existing `out/<window>/` folder. It does not regenerate the report.

```sh
bun run preview
bun run preview --month 2026-09
bun run preview --last-month
bun run preview --all-time
bun run preview -- 2026-09
```

The last form is a folder name under `out/`. The default folder is `last-30d`.

### Fetch

```sh
bun run fetch
bun run fetch -- --config path/to/report.config.json
```

Runs `git fetch --all --prune` in each configured repo. Continues after
per-repo failures and exits 1 if any failed. Prefer this (or `report --fetch`)
over `git pull` so working trees stay untouched.

### When a report looks empty

```sh
bun run doctor
bun run authors
bun run authors --last-month
bun run authors --all-time
bun run authors --month 2026-09
```

`doctor` lists what each collection picked up and skipped, checks each repo
(directory exists, is a git work tree, has remotes) and warns if `FETCH_HEAD` is
missing or older than 7 days. It then checks whether each `subjectEmails` entry
has any commit in the last 90 days, and whether `gh` is installed and logged in
(with the `owner/name` each repo maps to). Hard failures exit 1; warnings and
GitHub status never do.

`authors` lists author name, email, and commit counts for the same date
windows as `report`. Rows that match `subjectEmails` are marked with `*`.

Both accept `-- --config path/to/report.config.json`.

### Maintenance

```sh
bun run clean                   # delete out/
bun run test
bun run type-check              # tsc --noEmit
bun run check                   # biome check ./src
bun run check:fix               # biome check --write ./src
bun run format                  # biome format --write ./src
```

## License

[MIT](LICENSE)
