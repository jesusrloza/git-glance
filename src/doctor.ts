import { existsSync } from 'node:fs'
import { configFlagUsage, loadConfig, stripConfigFlag } from './config.ts'
import { emailHasCommits, fetchHeadAgeMs, isGitRepo, listRemotes } from './git.ts'
import { githubStateNote, githubStatus, repoSlug } from './github.ts'

const STALE_FETCH_MS = 7 * 24 * 60 * 60 * 1000
const EMAIL_LOOKBACK_DAYS = 90

function usage(): string {
  return `Usage:
  bun run doctor
  bun run doctor -- --config path/to/report.config.json

Lists what each collection picked up and skipped, then checks each repo
(directory exists, is a git work tree, has remotes, fetch freshness), whether
each subjectEmails entry appears in commits from the last ${EMAIL_LOOKBACK_DAYS} days, and
whether gh is installed and logged in for the GitHub cards. Exits 1 on hard
failures; warnings alone exit 0.

Options:
${configFlagUsage()}
`
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
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
  let hardFail = false
  const warnings: string[] = []

  console.log(`Config: ${configPath}`)
  console.log('')

  for (const c of config.collections) {
    console.log(`Collection ${c.path}: ${c.repos.length} repo${c.repos.length === 1 ? '' : 's'}`)
    for (const skip of c.skipped) console.log(`  – ${skip.name} (${skip.reason})`)
  }
  if (config.collections.length > 0) console.log('')

  for (const repo of config.repos) {
    if (!existsSync(repo.path)) {
      console.error(`✗ ${repo.name}: missing directory (${repo.path})`)
      hardFail = true
      continue
    }
    if (!(await isGitRepo(repo.path))) {
      console.error(`✗ ${repo.name}: not a git repo (${repo.path})`)
      hardFail = true
      continue
    }

    const remotes = await listRemotes(repo.path)
    if (remotes.length === 0) {
      console.error(`✗ ${repo.name}: no remotes configured`)
      hardFail = true
      continue
    }

    const age = fetchHeadAgeMs(repo.path)
    if (age === null) {
      warnings.push(`${repo.name}: no FETCH_HEAD yet (run bun run fetch)`)
      console.log(`✓ ${repo.name}: git ok, remotes [${remotes.join(', ')}] — never fetched?`)
    } else if (age > STALE_FETCH_MS) {
      warnings.push(`${repo.name}: last fetch ${formatAge(age)} (stale > 7d)`)
      console.log(`✓ ${repo.name}: git ok, remotes [${remotes.join(', ')}] — fetch ${formatAge(age)} (stale)`)
    } else {
      console.log(`✓ ${repo.name}: git ok, remotes [${remotes.join(', ')}] — fetch ${formatAge(age)}`)
    }
  }

  console.log('')
  console.log(`Subject emails (any commit in last ${EMAIL_LOOKBACK_DAYS}d):`)
  for (const email of config.subjectEmails) {
    const hit = await emailHasCommits(config.repos, email, EMAIL_LOOKBACK_DAYS)
    if (hit) {
      console.log(`✓ ${email}`)
    } else {
      warnings.push(`${email}: no commits in last ${EMAIL_LOOKBACK_DAYS}d — check authors / config`)
      console.log(`⚠ ${email}: no commits in last ${EMAIL_LOOKBACK_DAYS}d`)
    }
  }

  console.log('')
  console.log('GitHub (optional):')
  const gh = await githubStatus(config.github)
  if (gh.login) {
    console.log(`✓ gh logged in as ${gh.login}`)
    for (const repo of config.repos) {
      const slug = await repoSlug(repo)
      console.log(slug ? `  ${repo.name} → ${slug}` : `  ${repo.name}: not on GitHub, no GitHub cards for it`)
    }
  } else {
    console.log(`– ${githubStateNote(gh.state)}`)
  }

  if (warnings.length > 0) {
    console.log('')
    console.log('Warnings:')
    for (const w of warnings) console.log(`  - ${w}`)
  }

  if (hardFail) {
    process.exit(1)
  }
  console.log('')
  console.log(warnings.length > 0 ? 'Doctor finished with warnings.' : 'Doctor OK.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
