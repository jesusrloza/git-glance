/**
 * Deterministic repo colors by config index.
 * The first five are a hand-picked seed set; later indices use golden-angle hue
 * steps (no wrap collision with the seed set).
 */

export type ThemeMode = 'dark' | 'light'

const SEED_DARK = ['#2dd4bf', '#818cf8', '#f472b6', '#fbbf24', '#38bdf8'] as const
const SEED_LIGHT = ['#0f766e', '#4338ca', '#be185d', '#b45309', '#0369a1'] as const

/** Golden angle in degrees — spreads hues without clustering. */
const GOLDEN_ANGLE = 137.508

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function derivedColor(index: number, theme: ThemeMode): string {
  const hue = (index * GOLDEN_ANGLE) % 360
  if (theme === 'dark') return hslToHex(hue, 72, 62)
  return hslToHex(hue, 68, 38)
}

/** Hex color for repo at `index` in the configured repos array. */
export function repoColorAt(index: number, theme: ThemeMode): string {
  if (index < 0) throw new Error(`repoColorAt: index must be >= 0, got ${index}`)
  const seed = theme === 'dark' ? SEED_DARK : SEED_LIGHT
  if (index < seed.length) return seed[index]!
  return derivedColor(index, theme)
}

/** CSS custom-property block for `--repo-0` … `--repo-(n-1)`. */
export function repoColorCssVars(count: number, theme: ThemeMode): string {
  if (count <= 0) return ''
  const lines: string[] = []
  for (let i = 0; i < count; i++) {
    lines.push(`  --repo-${i}: ${repoColorAt(i, theme)};`)
  }
  return lines.join('\n')
}
