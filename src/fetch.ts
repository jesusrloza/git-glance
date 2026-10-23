import { configFlagUsage, loadConfig, stripConfigFlag } from './config.ts'
import { fetchRepos } from './git.ts'

function usage(): string {
  return `Usage:
  bun run fetch
  bun run fetch -- --config path/to/report.config.json

Runs git fetch --all --prune in each repo listed in the config file.
Exits 1 if any repo fails.

Options:
${configFlagUsage()}
`
}

async function main() {
  const { args, configPath } = stripConfigFlag(Bun.argv.slice(2))
  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage())
    process.exit(0)
  }
  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(' ')}\n\n${usage()}`)
  }

  const config = await loadConfig(configPath)
  console.log(`Config: ${configPath}`)
  console.log(`Fetching ${config.repos.length} repos`)
  const result = await fetchRepos(config.repos)
  if (result.failed.length > 0) {
    throw new Error(`Fetch failed for: ${result.failed.join(', ')}`)
  }
  console.log(`Done. Updated ${result.ok.length} repos.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
