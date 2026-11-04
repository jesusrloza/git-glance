import { configFlagUsage, loadConfig, stripConfigFlag } from './config.ts'
import { fetchRepos, isGitRepo } from './git.ts'
import { type BranchResult, pullRepo } from './pull-branches.ts'

function usage(): string {
  return `Usage:
  bun run pull
  bun run pull -- --no-fetch
  bun run pull -- --config path/to/report.config.json

Runs git fetch --all --prune in each configured repo (skip with --no-fetch), then
fast-forwards every local branch that tracks an upstream and is only behind it,
including branches that are not checked out. Never merges, rebases or resets:
branches with local commits, a dirty checkout, or a deleted upstream are listed
and left alone. Exits 1 if any repo or fast-forward fails.

Options:
  --no-fetch  Use the refs already fetched
${configFlagUsage()}
`
}

const NOTE: Record<BranchResult['action'], string> = {
  'up-to-date': '',
  'fast-forward': 'fast-forwarded',
  ahead: 'has local commits not on its upstream, left alone',
  diverged: 'diverged from its upstream, left alone',
  dirty: 'checked out with uncommitted changes, left alone',
  'upstream-gone': 'upstream was deleted on the remote; delete the branch if it is merged',
  'other-worktree': 'checked out in another work tree, left alone',
}

async function main() {
  const { args, configPath } = stripConfigFlag(Bun.argv.slice(2))
  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage())
    process.exit(0)
  }
  const noFetch = args.includes('--no-fetch')
  const unknown = args.filter((a) => a !== '--no-fetch')
  if (unknown.length > 0) {
    throw new Error(`Unknown arguments: ${unknown.join(' ')}\n\n${usage()}`)
  }

  const config = await loadConfig(configPath)
  console.log(`Config: ${configPath}`)
  const failed: string[] = []
  if (!noFetch) {
    console.log(`Fetching ${config.repos.length} repos`)
    failed.push(...(await fetchRepos(config.repos)).failed)
  }

  console.log('\nUpdating local branches')
  let moved = 0
  for (const repo of config.repos) {
    if (failed.includes(repo.name) || !(await isGitRepo(repo.path))) continue
    const results = await pullRepo(repo.path)
    const lines: string[] = []
    for (const r of results) {
      if (r.error) {
        lines.push(`  ✗ ${r.branch}: fast-forward failed: ${r.error}`)
        failed.push(`${repo.name}/${r.branch}`)
      } else if (r.action === 'fast-forward') {
        lines.push(`  ✓ ${r.branch}: ${NOTE[r.action]} ${r.behind}`)
        moved++
      } else if (r.action !== 'up-to-date') {
        lines.push(
          `  ! ${r.branch}: ${NOTE[r.action]}${r.ahead || r.behind ? ` (ahead ${r.ahead}, behind ${r.behind})` : ''}`,
        )
      }
    }
    console.log(lines.length ? `${repo.name}\n${lines.join('\n')}` : `${repo.name}: up to date`)
  }

  if (failed.length > 0) throw new Error(`\nFailed: ${failed.join(', ')}`)
  console.log(`\nDone. ${moved} branch${moved === 1 ? '' : 'es'} fast-forwarded.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
