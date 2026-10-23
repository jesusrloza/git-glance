# Configuration

The tool reads a JSON file that lists your author emails and the git repositories
to scan. Nothing about a particular workspace is hard-coded in the source.

## Files

| File | Tracked | Role |
|------|---------|------|
| [`config/report.config.example.json`](../config/report.config.example.json) | yes | Template with sample emails, a collection and extra repos |
| `config/report.config.json` | no (gitignored) | Your live config |

First-time setup:

```sh
cp config/report.config.example.json config/report.config.json
```

Edit the live file for the machine and workspace you are on. Commit only the
example when you want to share a new template shape.

## Shape

```json
{
  "subjectEmails": [
    "you@example.com",
    "12345678+you@users.noreply.github.com"
  ],
  "collections": [
    {
      "path": "~/Documents/gh/work",
      "exclude": ["git-glance"],
      "labels": { "my-long-repo-name": "short" }
    }
  ],
  "repos": [
    "../one-off-repo",
    { "path": "/abs/path/to/fork", "label": "fork", "github": "acme/fork" }
  ],
  "excludePaths": ["**/db.json"],
  "github": true,
  "subjectLogins": []
}
```

| Field | Rules |
|-------|--------|
| `subjectEmails` | Non-empty array of strings. Matched case-insensitively against commit author emails. All listed addresses merge into one “you” on the dashboard. |
| `collections` | Optional array. Each entry is a folder path string, or `{ "path", "exclude"?, "labels"? }`. Every immediate, non-hidden child folder that has a `.git` is a repo. |
| `collections[].exclude` | Child folders to leave out, by folder name (`"git-glance"`) or by path (`"../git-glance"`, `"/abs/…"`). |
| `collections[].labels` | Folder name → short display label. |
| `repos` | Optional array. Each entry is a path string or `{ "path", "label"?, "github"? }`. `dir` is still accepted in place of `path`. `github` (`"owner/name"`) overrides the slug read from the `origin` remote. |
| `excludePaths` | Optional array of glob patterns, matched against repo-relative paths, left out of line counts, hotspots and collaboration. Added to the built-in list below. Example: `["**/db.json", "src/generated/**"]`. |
| `github` | Optional, default `true`. Load the GitHub cards when `gh` is installed and logged in. `false` never calls `gh`. `--no-github` on `report`/`view` does the same for one run. |
| `subjectLogins` | Optional GitHub logins that also count as you. The logged-in `gh` user, and logins in noreply `subjectEmails`, always count. |

At least one of `collections` or `repos` must be set, and together they must
resolve to at least one repo.

### Migrating from `workspaceRoot`

Older configs had `workspaceRoot` plus short `dir` names. Those configs are now
rejected with a hint. Replace them with a collection, which also picks up new
checkouts automatically:

```json
"collections": [{ "path": "..", "exclude": ["git-glance"], "labels": { "my-long-repo": "short" } }]
```

or keep a hand-picked list with full paths: `"repos": ["../my-long-repo"]`.

## Line-count exclusions

Line stats come from `git log --numstat`. These paths are always skipped
because they say little about the work done (`DEFAULT_EXCLUDE_PATHS` in
`src/git.ts`):

`**/bun.lock`, `**/bun.lockb`, `**/package-lock.json`, `**/yarn.lock`,
`**/pnpm-lock.yaml`, `**/Cargo.lock`, `**/go.sum`, `**/poetry.lock`,
`**/composer.lock`, `**/*.min.js`, `**/*.min.css`, `**/*.map`, `**/*.snap`,
`**/dist/**`, `**/build/**`, `**/node_modules/**`.

Commit counts are not affected; only lines and file lists. Binary files count as
touched with 0 lines.

## How paths resolve

Every path in the config (collection `path` and `exclude`, repo `path`) is one
of:

- **Absolute**: used as-is.
- **`~/…`**: under your home directory.
- **Relative**: resolved against the **project root** (this package), so `".."`
  is the folder that holds this checkout.

Then:

- **Order** (and so colors): collections in config order, each one
  alphabetical, then `repos` in config order.
- A repo reached twice (in a collection and in `repos`) appears once. The
  `repos` entry's `label` and `github` win.
- **Identity** on commits and charts is the folder basename (`name`).
- **Display** uses `label` when set; otherwise `name`.
- Duplicate `name` or duplicate `label` values are rejected at load.

## Colors

Chart colors are **not** in the config. They are assigned by **index** in the
resolved repo order from a fixed palette in code (`src/repo-palette.ts`):

- Same repos in the same order → same colors on every report window.
- Adding a checkout to a collection, removing one, or reordering may shift
  colors. They are still fully deterministic.

## `--config`

Every command that loads settings accepts:

```sh
bun run report -- --config /path/to/other-workspace.config.json
bun run doctor -- --config ./clients/acme/report.config.json
bun run view -- --config ./clients/acme/report.config.json --last-month
```

Default when omitted: `config/report.config.json` under this project.

For another machine or client, point `collections` at that machine's checkout
folder (often an absolute or `~/…` path).

## Discovering emails

If the calendar looks empty or thin:

```sh
bun run authors
bun run authors --month 2026-09
bun run authors --all-time
```


Rows marked `*` already match `subjectEmails`. Add any unmarked addresses that
are yours, then re-run the report.
