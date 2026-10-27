import { toBlob, toPng } from 'html-to-image'
import { cssVar } from './common.ts'

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

type CaptureOptions = Parameters<typeof toPng>[1]

/**
 * Lay `node` out at a fixed export width, optionally stamp a footer line on
 * it, run the html-to-image call, then put everything back. Controls
 * (`.no-export`) are left out of the image.
 */
async function capture<T>(
  node: HTMLElement,
  footer: string | null,
  run: (node: HTMLElement, opts: CaptureOptions) => Promise<T>,
): Promise<T> {
  // Crop to the content column instead of the full viewport width.
  const width = Math.min(node.scrollWidth, 1160)
  // html-to-image inlines computed styles, so `margin: 0 auto` on header/main
  // would be baked in as viewport-sized px margins. Lay the live node out at
  // the export width (kept centered on screen) so those margins resolve against it.
  const prev = node.style.cssText
  node.style.width = `${width}px`
  node.style.margin = '0 auto'
  let stamp: HTMLElement | null = null
  if (footer) {
    stamp = document.createElement('p')
    stamp.className = 'export-stamp'
    stamp.textContent = footer
    node.append(stamp)
  }
  try {
    return await run(node, {
      width,
      height: node.scrollHeight,
      style: { width: `${width}px`, margin: '0' },
      pixelRatio: 2,
      backgroundColor: cssVar('--bg'),
      filter: (el) => !(el instanceof HTMLElement && el.classList.contains('no-export')),
    })
  } finally {
    stamp?.remove()
    node.style.cssText = prev
  }
}

function download(url: string, filenameParts: string[]) {
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenameParts.map(slug).filter(Boolean).join('-')}.png`
  a.click()
}

/** Snapshot `node` (the whole `.shell`, or one card) to a PNG download. */
export async function exportPng(node: HTMLElement, filenameParts: string[], footer: string | null = null) {
  download(await capture(node, footer, toPng), filenameParts)
}

/**
 * Put a PNG of `node` on the clipboard, ready to paste into chat or a doc.
 * Falls back to a download where the browser can't write images to the
 * clipboard. Returns which of the two happened.
 */
export async function copyPng(
  node: HTMLElement,
  filenameParts: string[],
  footer: string | null = null,
): Promise<'copied' | 'downloaded'> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      // Hand the clipboard a promise so the write still counts as part of the click (Safari).
      const blob = capture(node, footer, toBlob).then((b) => {
        if (!b) throw new Error('html-to-image returned no blob')
        return b
      })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return 'copied'
    } catch (err) {
      console.warn('Clipboard image copy failed; downloading instead', err)
    }
  }
  await exportPng(node, filenameParts, footer)
  return 'downloaded'
}

/**
 * Copy text to the clipboard and confirm on the button for a moment. Returns
 * false when the browser refuses (no secure context or permission).
 */
export async function copyText(button: HTMLButtonElement, text: string): Promise<boolean> {
  const label = button.textContent
  try {
    await navigator.clipboard.writeText(text)
    button.textContent = 'Copied'
    return true
  } catch (err) {
    console.error('Copy failed', err)
    button.textContent = 'Copy failed'
    return false
  } finally {
    setTimeout(() => {
      button.textContent = label
    }, 1500)
  }
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
