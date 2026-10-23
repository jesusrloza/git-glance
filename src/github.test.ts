import { describe, expect, test } from 'bun:test'
import { noreplyLogin, parseCommitLogins, parsePrList, parseRemoteUrl, parseRunList, rollupChecks } from './github.ts'
import { customRange } from './window.ts'

describe('parseRemoteUrl', () => {
  test('ssh, ssh:// and https forms', () => {
    expect(parseRemoteUrl('git@github.com:acme/app.git')).toBe('acme/app')
    expect(parseRemoteUrl('ssh://git@github.com/acme/app.git')).toBe('acme/app')
    expect(parseRemoteUrl('https://github.com/acme/app.js\n')).toBe('acme/app.js')
    expect(parseRemoteUrl('https://token@github.com/acme/app/')).toBe('acme/app')
  })

  test('other hosts are not GitHub', () => {
    expect(parseRemoteUrl('git@gitlab.com:acme/app.git')).toBeNull()
  })
})

test('noreplyLogin', () => {
  expect(noreplyLogin('12345678+Me@users.noreply.github.com')).toBe('me')
  expect(noreplyLogin('me@users.noreply.github.com')).toBe('me')
  expect(noreplyLogin('me@example.com')).toBeNull()
})

test('rollupChecks', () => {
  expect(rollupChecks([])).toBe('none')
  expect(rollupChecks([{ __typename: 'CheckRun', conclusion: 'SUCCESS' }])).toBe('success')
  expect(rollupChecks([{ __typename: 'CheckRun', conclusion: null, status: 'IN_PROGRESS' }])).toBe('pending')
  expect(
    rollupChecks([
      { __typename: 'CheckRun', conclusion: 'SUCCESS' },
      { __typename: 'StatusContext', state: 'FAILURE' },
    ]),
  ).toBe('failure')
})

describe('parsePrList', () => {
  const window = customRange('2026-10-01', '2026-10-31')
  const pr = (number: number, createdAt: string, reviews: { login: string; at: string }[] = []) => ({
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'MERGED',
    isDraft: false,
    author: { login: 'Me' },
    createdAt,
    mergedAt: null,
    closedAt: null,
    headRefName: 'feat/x',
    baseRefName: 'main',
    reviewDecision: null,
    reviews: reviews.map((r) => ({ author: { login: r.login }, state: 'APPROVED', submittedAt: r.at, body: 'long' })),
    statusCheckRollup: [],
  })
  const text = JSON.stringify([
    pr(1, '2026-10-05T10:00:00Z'),
    pr(2, '2026-09-01T10:00:00Z', [{ login: 'Other', at: '2026-10-02T10:00:00Z' }]),
    pr(3, '2026-09-01T10:00:00Z'),
  ])
  const prs = parsePrList(text, 'alpha', window)

  test('buckets by local day, not the UTC date prefix', () => {
    const tz = process.env.TZ
    process.env.TZ = 'America/Mexico_City' // UTC-6, no DST in 2026
    try {
      const evening = parsePrList(
        JSON.stringify([pr(9, '2026-10-23T00:05:05Z')]),
        'alpha',
        customRange('2026-09-23', '2026-10-22'),
      )
      expect(evening.map((p) => p.number)).toEqual([9])
      // 05:30Z on the 1st is still Sep 30 locally.
      const early = parsePrList(JSON.stringify([pr(8, '2026-10-01T05:30:00Z')]), 'alpha', window)
      expect(early).toEqual([])
    } finally {
      if (tz === undefined) Reflect.deleteProperty(process.env, 'TZ')
      else process.env.TZ = tz
    }
  })

  test('keeps PRs opened or reviewed in the window, lower-cases logins', () => {
    expect(prs.map((p) => p.number)).toEqual([1, 2])
    expect(prs[0]!.author).toBe('me')
    expect(prs[1]!.reviews).toEqual([{ login: 'other', state: 'APPROVED', iso: '2026-10-02T10:00:00Z' }])
    expect(prs[0]!.reviewDecision).toBe('')
    expect(prs[0]!.checks).toBe('none')
  })
})

test('parseRunList', () => {
  const runs = parseRunList(
    JSON.stringify([
      {
        databaseId: 7,
        workflowName: 'CI',
        headSha: 'abc',
        headBranch: 'main',
        event: 'push',
        conclusion: 'success',
        status: 'completed',
        createdAt: '2026-10-02T00:00:00Z',
        url: 'u',
      },
    ]),
    'alpha',
  )
  expect(runs[0]).toMatchObject({ repo: 'alpha', id: 7, workflow: 'CI', headSha: 'abc', iso: '2026-10-02T00:00:00Z' })
})

test('parseCommitLogins', () => {
  const map = new Map<string, Set<string>>()
  parseCommitLogins('a\tMe\tMe@Example.com\nb\t\tnobody@example.com\nc\tme\tme@work.com\n', map)
  expect([...map.get('me')!].sort()).toEqual(['me@example.com', 'me@work.com'])
  expect(map.size).toBe(1)
})
