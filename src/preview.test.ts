import { expect, test } from 'bun:test'
import { previewFolderLabel } from './preview.ts'
import { lastMonth } from './window.ts'

test('preview folder matches report window flags', () => {
  expect(previewFolderLabel([])).toBe('last-30d')
  expect(previewFolderLabel(['--all-time'])).toBe('all-time')
  expect(previewFolderLabel(['--month', '2026-09'])).toBe('2026-09')
  expect(previewFolderLabel(['--last-month'])).toBe(lastMonth().label)
  expect(previewFolderLabel(['2026-09'])).toBe('2026-09')
})
