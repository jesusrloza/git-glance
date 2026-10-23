import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { configFlagUsage, loadConfig, projectRoot, stripConfigFlag } from './config.ts'
import { parseWindowArgs, windowFlagsUsage } from './window-args.ts'
import { resolveWindow } from './resolve-window.ts'
import { fetchRepos, loadAllCommits, loadBranches, loadTags } from './git.ts'
import { githubStateNote, githubStatus, loadGithub } from './github.ts'
import { previousWindow } from './window.ts'
import { aggregate } from './aggregate.ts'
import { renderMarkdown } from './render/markdown.ts'
import { renderHtml } from './render/html.ts'

function usage(): string {
  return `Usage:
  bun run report
  bun run report --fetch
  bun run report --month YYYY-MM
  bun run report --last-month
  bun run report --all-time
  bun run report --fetch --last-month
  bun run report --no-github
  bun run report -- --config path/to/report.config.json

Options:
  --fetch       git fetch --all --prune in each configured repo first
  --no-github   skip the GitHub cards even when gh is installed and logged in
${configFlagUsage()}

${windowFlagsUsage()}

Writes out/<window>/commit-visibility.md, commit-visibility.html, and index.html

Windows: default last 30 days, --month, --last-month, --all-time (month grain).
Use bun run view to generate then open; bun run preview --all-time (or --month, --last-month) to reopen.
`
}

function stripFlag(args: string[], flag: string): { args: string[]; set: boolean } {
  return { args: args.filter((a) => a !== flag), set: args.includes(flag) }
}

async function main() {
  const { args: withoutConfig, configPath } = stripConfigFlag(Bun.argv.slice(2))
  const { args: withoutFetch, set: wantFetch } = stripFlag(withoutConfig, '--fetch')
  const { args, set: noGithub } = stripFlag(withoutFetch, '--no-github')
  const spec = parseWindowArgs(args, usage())
  const config = await loadConfig(configPath)
  const repoNames = config.repos.map((r) => r.name)

  if (wantFetch) {
    const result = await fetchRepos(config.repos)
    if (result.failed.length > 0) {
      throw new Error(`Fetch failed for: ${result.failed.join(', ')}`)
    }
  }

  const window = await resolveWindow(spec, config.repos)
  console.log(`Window ${window.start} → ${window.end} (${window.label}, grain=${window.grain})`)
  console.log(`Config: ${configPath}`)
  console.log(`Repos: ${repoNames.join(', ')}`)

  const gh = await githubStatus(config.github && !noGithub)
  const githubNote = githubStateNote(gh.state)
  console.log(gh.login ? `GitHub: gh logged in as ${gh.login}` : (githubNote ?? ''))

  const opts = { stats: true, excludePaths: config.excludePaths }
  const prevWindow = previousWindow(window)
  const [commits, previousCommits, branches, tags, github] = await Promise.all([
    loadAllCommits(config.repos, window, opts),
    prevWindow ? loadAllCommits(config.repos, prevWindow, opts) : Promise.resolve([]),
    Promise.all(config.repos.map((r) => loadBranches(r, window))).then((b) => b.flat()),
    Promise.all(config.repos.map((r) => loadTags(r, window))).then((t) => t.flat()),
    gh.login ? loadGithub(config.repos, window, gh.login, config.subjectLogins, config.subjectEmails) : null,
  ])
  console.log(
    `Loaded ${commits.length} commits (${previousCommits.length} in previous window), ${branches.length} unmerged branches, ${tags.length} tags`,
  )
  if (github) {
    console.log(`GitHub: ${github.prs.length} PRs, ${github.runs.length} workflow runs`)
  }

  const data = aggregate(commits, config, window, {
    previousWindow: prevWindow,
    previousCommits,
    branches,
    tags,
    github,
    githubNote,
  })
  const outDir = resolve(projectRoot, 'out', window.label)
  await mkdir(outDir, { recursive: true })

  const mdPath = resolve(outDir, 'commit-visibility.md')
  const htmlPath = resolve(outDir, 'commit-visibility.html')
  const indexPath = resolve(outDir, 'index.html')
  const html = await renderHtml(data, projectRoot)

  await Bun.write(mdPath, renderMarkdown(data))
  await Bun.write(htmlPath, html)
  await Bun.write(indexPath, html)

  const unit = data.grain === 'month' ? 'months' : 'weekdays'
  console.log(`Wrote ${mdPath}`)
  console.log(`Wrote ${htmlPath}`)
  console.log(`Wrote ${indexPath}`)
  console.log(
    `You: ${data.subjectCommits.length} commits, ${data.weekdays.length - data.emptyWeekdays.length}/${data.weekdays.length} ${unit} active, ${data.emptyWeekdays.length} empty`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
