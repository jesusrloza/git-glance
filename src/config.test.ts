import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { parseConfig, projectRoot, resolveConfigPath } from './config.ts'

const emails = ['me@example.com']
let root = ''

/** `.git` is all discovery looks for, so an empty folder stands in for a checkout. */
function repo(...parts: string[]) {
  mkdirSync(join(root, ...parts, '.git'), { recursive: true })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'git-glance-config-'))
  repo('ws', 'beta')
  repo('ws', 'alpha')
  repo('ws', 'self')
  mkdirSync(join(root, 'ws', 'notes'))
  mkdirSync(join(root, 'ws', '.hidden', '.git'), { recursive: true })
  repo('elsewhere', 'gamma')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveConfigPath', () => {
  test('absolute, ~ and project-relative paths', () => {
    expect(resolveConfigPath('/abs/x')).toBe('/abs/x')
    expect(resolveConfigPath('~/code/x')).toBe(join(homedir(), 'code/x'))
    expect(resolveConfigPath('..')).toBe(resolve(projectRoot, '..'))
  })
})

describe('collections', () => {
  test('picks up git children alphabetically and reports what it skipped', () => {
    const config = parseConfig({ subjectEmails: emails, collections: [join(root, 'ws')] }, 'test.json')
    expect(config.repos.map((r) => r.name)).toEqual(['alpha', 'beta', 'self'])
    expect(config.collections[0]!.skipped).toEqual([{ name: 'notes', reason: 'not a git repo' }])
  })

  test('exclude by folder name, absolute path or project-relative path', () => {
    for (const entry of ['self', join(root, 'ws', 'self'), relative(projectRoot, join(root, 'ws', 'self'))]) {
      const config = parseConfig(
        { subjectEmails: emails, collections: [{ path: join(root, 'ws'), exclude: [entry] }] },
        'test.json',
      )
      expect(config.repos.map((r) => r.name)).toEqual(['alpha', 'beta'])
    }
  })

  test('labels, then explicit repos after collections, deduped by path', () => {
    const config = parseConfig(
      {
        subjectEmails: emails,
        collections: [{ path: join(root, 'ws'), exclude: ['self'], labels: { alpha: 'a' } }],
        repos: [join(root, 'elsewhere', 'gamma'), { path: join(root, 'ws', 'beta'), label: 'b', github: 'o/beta' }],
      },
      'test.json',
    )
    expect(config.repos.map((r) => [r.name, r.label])).toEqual([
      ['alpha', 'a'],
      ['beta', 'b'],
      ['gamma', 'gamma'],
    ])
    expect(config.repos[1]!.github).toBe('o/beta')
  })

  test('github toggle defaults to on', () => {
    expect(parseConfig({ subjectEmails: emails, repos: [join(root, 'ws', 'alpha')] }, 't').github).toBe(true)
    expect(parseConfig({ subjectEmails: emails, repos: [join(root, 'ws', 'alpha')], github: false }, 't').github).toBe(
      false,
    )
  })

  test('rejects workspaceRoot, missing folders and empty results', () => {
    expect(() => parseConfig({ subjectEmails: emails, workspaceRoot: '..', repos: ['x'] }, 't')).toThrow(
      /workspaceRoot/,
    )
    expect(() => parseConfig({ subjectEmails: emails, collections: [join(root, 'nope')] }, 't')).toThrow(
      /not a directory/,
    )
    expect(() => parseConfig({ subjectEmails: emails, collections: [join(root, 'ws', 'alpha')] }, 't')).toThrow(
      /no git repos/,
    )
    expect(() => parseConfig({ subjectEmails: emails }, 't')).toThrow(/collections or repos/)
  })
})
