import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { configFlagUsage, loadConfig, projectRoot, stripConfigFlag } from './config.ts'
import { parseWindowArgs, windowFlagsUsage } from './window-args.ts'
import { resolveWindow } from './resolve-window.ts'

function usage(): string {
  return `Usage:
  bun run view
  bun run view --fetch
  bun run view --month YYYY-MM
  bun run view --last-month
  bun run view --all-time
  bun run view -- --config path/to/report.config.json

Generates the report (same flags as bun run report), then serves out/<window>/.

To reopen an already-generated report without regenerating:
  bun run preview --month 2026-09
  bun run preview --all-time
  bun run preview              # last-30d

Options:
  --fetch       passed through to report (fetch remotes first)
  --no-github   passed through to report (skip the GitHub cards)
${configFlagUsage()}

${windowFlagsUsage()}
`
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        resolvePromise(1)
        return
      }
      resolvePromise(code ?? 0)
    })
  })
}

async function main() {
  const rawArgs = Bun.argv.slice(2)
  const { args: withoutConfig, configPath } = stripConfigFlag(rawArgs)
  const withoutFetch = withoutConfig.filter((a) => a !== '--fetch' && a !== '--no-github')
  const spec = parseWindowArgs(withoutFetch, usage())
  const config = await loadConfig(configPath)
  const window = await resolveWindow(spec, config.repos)

  const bunBin = process.execPath
  const cli = resolve(projectRoot, 'src/cli.ts')
  const preview = resolve(projectRoot, 'src/preview.ts')

  const reportCode = await run(bunBin, [cli, ...rawArgs])
  if (reportCode !== 0) process.exit(reportCode)

  const previewCode = await run(bunBin, [preview, window.label])
  process.exit(previewCode)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
