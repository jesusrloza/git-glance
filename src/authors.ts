import { configFlagUsage, loadConfig, stripConfigFlag } from './config.ts'
import { loadAllCommits } from './git.ts'
import { parseWindowArgs, windowFlagsUsage } from './window-args.ts'
import { resolveWindow } from './resolve-window.ts'

function usage(): string {
  return `Usage:
  bun run authors
  bun run authors --month YYYY-MM
  bun run authors --last-month
  bun run authors --all-time
  bun run authors -- --config path/to/report.config.json

Lists author emails in the window (commit counts), marking those that
match subjectEmails in the config file.

Options:
${configFlagUsage()}

${windowFlagsUsage()}
`
}

type AuthorRow = {
  email: string
  name: string
  commits: number
  repos: Set<string>
  isSubject: boolean
}

async function main() {
  const { args, configPath } = stripConfigFlag(Bun.argv.slice(2))
  const spec = parseWindowArgs(args, usage())
  const config = await loadConfig(configPath)
  const window = await resolveWindow(spec, config.repos)
  const subject = new Set(config.subjectEmails.map((e) => e.toLowerCase()))

  console.log(`Window ${window.start} → ${window.end} (${window.label})`)
  console.log(`Config: ${configPath}`)
  const commits = await loadAllCommits(config.repos, window)
  console.log(`Loaded ${commits.length} commits across ${config.repos.length} repos`)
  console.log('')

  const byEmail = new Map<string, AuthorRow>()
  for (const c of commits) {
    const email = c.authorEmail.toLowerCase()
    let row = byEmail.get(email)
    if (!row) {
      row = {
        email,
        name: c.authorName,
        commits: 0,
        repos: new Set(),
        isSubject: subject.has(email),
      }
      byEmail.set(email, row)
    }
    row.commits += 1
    row.repos.add(c.repo)
    row.name = c.authorName
  }

  const rows = [...byEmail.values()].sort((a, b) => b.commits - a.commits || a.email.localeCompare(b.email))

  if (rows.length === 0) {
    console.log('No commits in this window.')
    return
  }

  const nameW = Math.max(4, ...rows.map((r) => r.name.length))
  const emailW = Math.max(5, ...rows.map((r) => r.email.length))

  console.log(`${'name'.padEnd(nameW)}  ${'email'.padEnd(emailW)}  ${'commits'.padStart(7)}  repos  subject`)
  for (const r of rows) {
    const mark = r.isSubject ? '*' : ''
    console.log(
      `${r.name.padEnd(nameW)}  ${r.email.padEnd(emailW)}  ${String(r.commits).padStart(7)}  ${r.repos.size}  ${mark}`,
    )
  }

  const matched = rows.filter((r) => r.isSubject).length
  console.log('')
  console.log(`* = in subjectEmails (${matched}/${subject.size} configured emails seen)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
