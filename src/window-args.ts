import type { DateWindow } from './types.ts'
import { calendarMonth, lastMonth, lastNDays, todayLocal } from './window.ts'

/** CLI may need async resolution (all-time earliest commit). */
export type WindowSpec = { kind: 'ready'; window: DateWindow } | { kind: 'all-time' }

/** Shared date-window flags used by report, authors, and view. */
export function windowFlagsUsage(): string {
  return `  --month YYYY-MM
  --last-month
  --all-time

Defaults to the last 30 days ending today.`
}

/**
 * Parse date-window flags from argv after the script name (Bun.argv.slice(2)).
 * Calls process.exit(0) on -h / --help when usage is printed.
 */
export function parseWindowArgs(args: string[], usage: string): WindowSpec {
  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage)
    process.exit(0)
  }

  const monthIdx = args.indexOf('--month')
  if (monthIdx !== -1) {
    const ym = args[monthIdx + 1]
    if (!ym) throw new Error('--month needs YYYY-MM')
    return { kind: 'ready', window: calendarMonth(ym) }
  }

  if (args.includes('--last-month')) {
    return { kind: 'ready', window: lastMonth(todayLocal()) }
  }

  if (args.includes('--all-time')) {
    const rest = args.filter((a) => a !== '--all-time')
    if (rest.length > 0) {
      throw new Error(`Unknown arguments with --all-time: ${rest.join(' ')}\n\n${usage}`)
    }
    return { kind: 'all-time' }
  }

  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(' ')}\n\n${usage}`)
  }

  return { kind: 'ready', window: lastNDays(30) }
}
