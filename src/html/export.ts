import { toPng } from 'html-to-image'
import { cssVar } from './common.ts'

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Snapshot `.shell` (header + cards) to a PNG download; controls are left out. */
export async function exportPng(filenameParts: string[]) {
  const node = document.querySelector('.shell') as HTMLElement | null
  if (!node) return
  // Crop to the content column instead of the full viewport width.
  const width = Math.min(node.scrollWidth, 1160)
  // html-to-image inlines computed styles, so `margin: 0 auto` on header/main
  // would be baked in as viewport-sized px margins. Lay the live shell out at
  // the export width (kept centered on screen) so those margins resolve against it.
  const prev = node.style.cssText
  node.style.width = `${width}px`
  node.style.margin = '0 auto'
  let url: string
  try {
    url = await toPng(node, {
      width,
      height: node.scrollHeight,
      style: { width: `${width}px`, margin: '0' },
      pixelRatio: 2,
      backgroundColor: cssVar('--bg'),
      filter: (el) => !(el instanceof HTMLElement && el.classList.contains('no-export')),
    })
  } finally {
    node.style.cssText = prev
  }
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenameParts.map(slug).filter(Boolean).join('-')}.png`
  a.click()
}

/**
 * Print in the light theme without saving it as the viewer's choice; the
 * browser's print dialog offers "Save as PDF".
 */
export function setupPrintTheme(onThemeApplied: () => void) {
  let restore: string | null = null
  window.addEventListener('beforeprint', () => {
    restore = document.documentElement.getAttribute('data-theme')
    if (restore !== 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
      onThemeApplied()
    }
  })
  window.addEventListener('afterprint', () => {
    if (restore && restore !== 'light') {
      document.documentElement.setAttribute('data-theme', restore)
      onThemeApplied()
    }
    restore = null
  })
}
