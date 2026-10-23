import type { DateWindow, RepoRef } from './types.ts'
import type { WindowSpec } from './window-args.ts'
import { earliestCommitDay } from './git.ts'
import { allTimeWindow, todayLocal } from './window.ts'

/** Resolve a parsed window spec (all-time needs the earliest commit across repos). */
export async function resolveWindow(spec: WindowSpec, repos: RepoRef[]): Promise<DateWindow> {
  if (spec.kind === 'ready') return spec.window

  const earliest = await earliestCommitDay(repos)
  if (!earliest) {
    throw new Error('No commits found in configured repos — cannot build an all-time window.')
  }
  return allTimeWindow(earliest, todayLocal())
}
