import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { CollectionInfo, ReportConfig, RepoRef } from './types.ts'

export const projectRoot = resolve(import.meta.dir, '..')

export const defaultConfigPath = resolve(projectRoot, 'config', 'report.config.json')
export const exampleConfigPath = resolve(projectRoot, 'config', 'report.config.example.json')

type FileRepoObject = {
  path?: unknown
  dir?: unknown
  label?: unknown
  github?: unknown
}

type FileCollection = {
  path?: unknown
  exclude?: unknown
  labels?: unknown
}

type FileConfig = {
  subjectEmails?: unknown
  subjectLogins?: unknown
  workspaceRoot?: unknown
  collections?: unknown
  repos?: unknown
  excludePaths?: unknown
  github?: unknown
}

/**
 * Pull `--config <path>` out of argv. Relative paths resolve against cwd.
 * Returns the remaining args and the absolute config path (default when absent).
 */
export function stripConfigFlag(args: string[]): { args: string[]; configPath: string } {
  const out: string[] = []
  let configPath = defaultConfigPath
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--config') {
      const value = args[i + 1]
      if (!value) throw new Error('--config needs a path')
      configPath = isAbsolute(value) ? value : resolve(process.cwd(), value)
      i++
      continue
    }
    out.push(arg)
  }
  return { args: out, configPath }
}

export function configFlagUsage(): string {
  return '  --config <path>   config file (default: config/report.config.json)'
}

/**
 * Absolute path from a config value: absolute as given, `~/…` under the home
 * directory, anything else relative to the project root (so ".." is the folder
 * that holds this checkout).
 */
export function resolveConfigPath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2))
  return isAbsolute(value) ? resolve(value) : resolve(projectRoot, value)
}

type ParsedRepoEntry = { path: string; label?: string; github?: string }

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function parseRepoEntry(entry: unknown, index: number): ParsedRepoEntry {
  if (typeof entry === 'string') {
    if (!entry.trim()) throw new Error(`repos[${index}]: path string must be non-empty`)
    return { path: resolveConfigPath(entry.trim()) }
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const obj = entry as FileRepoObject
    const raw = obj.path ?? obj.dir
    if (!nonEmptyString(raw)) {
      throw new Error(`repos[${index}]: object entries need a non-empty string "path"`)
    }
    if (obj.label !== undefined && !nonEmptyString(obj.label)) {
      throw new Error(`repos[${index}]: "label" must be a non-empty string when set`)
    }
    if (obj.github !== undefined && (typeof obj.github !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(obj.github))) {
      throw new Error(`repos[${index}]: "github" must look like "owner/name" when set`)
    }
    return {
      path: resolveConfigPath(raw.trim()),
      label: typeof obj.label === 'string' ? obj.label.trim() : undefined,
      github: typeof obj.github === 'string' ? obj.github : undefined,
    }
  }
  throw new Error(`repos[${index}]: each entry must be a string or { path, label?, github? }`)
}

function stringArray(value: unknown, where: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(nonEmptyString)) {
    throw new Error(`${where} must be an array of non-empty strings when set`)
  }
  return value.map((v) => v.trim())
}

/** A git checkout has `.git` (a folder, or a file for worktrees and submodules). */
function hasGitDir(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

/**
 * Immediate, non-hidden child folders of a collection that are git checkouts,
 * alphabetical. `exclude` entries match a child by folder name or by path.
 */
export function discoverCollection(raw: unknown, index: number): { info: CollectionInfo; entries: ParsedRepoEntry[] } {
  const where = `collections[${index}]`
  const obj = (typeof raw === 'string' ? { path: raw } : raw) as FileCollection | null
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !nonEmptyString(obj.path)) {
    throw new Error(`${where}: each entry must be a path string or { path, exclude?, labels? }`)
  }
  const root = resolveConfigPath(obj.path.trim())
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${where}: not a directory: ${root}`)
  }
  const exclude = stringArray(obj.exclude, `${where}.exclude`)
  const excludedPaths = new Set(exclude.map(resolveConfigPath))
  const excludedNames = new Set(exclude)
  let labels: Record<string, string> = {}
  if (obj.labels !== undefined) {
    if (
      !obj.labels ||
      typeof obj.labels !== 'object' ||
      Array.isArray(obj.labels) ||
      !Object.values(obj.labels).every(nonEmptyString)
    ) {
      throw new Error(`${where}.labels must map folder names to non-empty strings`)
    }
    labels = obj.labels as Record<string, string>
  }

  const info: CollectionInfo = { path: root, repos: [], skipped: [] }
  const entries: ParsedRepoEntry[] = []
  const children = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
  for (const name of children) {
    const path = join(root, name)
    if (excludedNames.has(name) || excludedPaths.has(path)) {
      info.skipped.push({ name, reason: 'excluded' })
      continue
    }
    if (!hasGitDir(path)) {
      info.skipped.push({ name, reason: 'not a git repo' })
      continue
    }
    info.repos.push(name)
    entries.push({ path, label: labels[name]?.trim() })
  }
  return { info, entries }
}

/** Dedupe by path (a later entry's label/github win), then check names and labels are unique. */
function resolveRepos(entries: ParsedRepoEntry[]): RepoRef[] {
  const byPath = new Map<string, ParsedRepoEntry>()
  for (const entry of entries) {
    const prior = byPath.get(entry.path)
    byPath.set(entry.path, prior ? { ...prior, ...stripUndefined(entry) } : entry)
  }

  const seenNames = new Map<string, string>()
  const seenLabels = new Map<string, string>()
  const repos: RepoRef[] = []
  for (const { path, label: labelOpt, github } of byPath.values()) {
    const name = basename(path)
    if (!name || name === '.' || name === '..') {
      throw new Error(`Could not derive a repo name from path: ${path}`)
    }
    const label = labelOpt ?? name

    const priorName = seenNames.get(name)
    if (priorName) {
      throw new Error(
        `Duplicate repo name "${name}" from paths:\n  ${priorName}\n  ${path}\nUse distinct folder names.`,
      )
    }
    const priorLabel = seenLabels.get(label)
    if (priorLabel) {
      throw new Error(`Duplicate repo label "${label}" for:\n  ${priorLabel}\n  ${name}\nLabels must be unique.`)
    }
    seenNames.set(name, path)
    seenLabels.set(label, name)
    repos.push(github ? { name, path, label, github } : { name, path, label })
  }
  return repos
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** Validate a parsed config object and resolve its collections and repos. */
export function parseConfig(raw: FileConfig, configPath: string): ReportConfig {
  if (raw.workspaceRoot !== undefined) {
    throw new Error(
      [
        `${configPath}: "workspaceRoot" is no longer supported.`,
        'List the folder under "collections" instead, e.g.',
        '  "collections": [{ "path": "..", "exclude": ["this-tool"] }]',
        'or give each repo a full path, e.g. "repos": ["../my-repo"]. See docs/configuration.md.',
      ].join('\n'),
    )
  }
  if (!Array.isArray(raw.subjectEmails) || !raw.subjectEmails.every((e) => typeof e === 'string')) {
    throw new Error(`${configPath}: subjectEmails must be an array of strings`)
  }
  if (raw.subjectEmails.length === 0) {
    throw new Error(`${configPath}: subjectEmails must list at least one email`)
  }
  if (raw.collections !== undefined && !Array.isArray(raw.collections)) {
    throw new Error(`${configPath}: collections must be an array when set`)
  }
  if (raw.repos !== undefined && !Array.isArray(raw.repos)) {
    throw new Error(`${configPath}: repos must be an array when set`)
  }
  if (raw.github !== undefined && typeof raw.github !== 'boolean') {
    throw new Error(`${configPath}: github must be true or false when set`)
  }
  const rawCollections = (raw.collections as unknown[] | undefined) ?? []
  const rawRepos = (raw.repos as unknown[] | undefined) ?? []
  if (rawCollections.length === 0 && rawRepos.length === 0) {
    throw new Error(`${configPath}: list at least one entry in collections or repos`)
  }

  const collections: CollectionInfo[] = []
  const entries: ParsedRepoEntry[] = []
  rawCollections.forEach((c, i) => {
    const found = discoverCollection(c, i)
    collections.push(found.info)
    entries.push(...found.entries)
  })
  rawRepos.forEach((r, i) => {
    entries.push(parseRepoEntry(r, i))
  })

  const repos = resolveRepos(entries)
  if (repos.length === 0) {
    throw new Error(`${configPath}: no git repos found in the configured collections`)
  }

  return {
    subjectEmails: raw.subjectEmails,
    subjectLogins: stringArray(raw.subjectLogins, `${configPath}: subjectLogins`),
    repos,
    collections,
    excludePaths: stringArray(raw.excludePaths, `${configPath}: excludePaths`),
    github: raw.github ?? true,
  }
}

export async function loadConfig(configPath: string = defaultConfigPath): Promise<ReportConfig> {
  const file = Bun.file(configPath)
  if (!(await file.exists())) {
    throw new Error(
      `Missing ${configPath}\nCopy the example and edit it:\n  cp ${exampleConfigPath} ${defaultConfigPath}`,
    )
  }
  return parseConfig((await file.json()) as FileConfig, configPath)
}
