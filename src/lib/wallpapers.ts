import type { CSSProperties } from 'react'

export const WALLPAPERS = ['default', 'sand', 'sage', 'sky', 'rose', 'plum', 'dots', 'grid', 'waves'] as const
/** No wallpaper chosen: the plain chat background. */
export const DEFAULT_WALLPAPER = WALLPAPERS[0]

const tint = (token: string) => `color-mix(in srgb, var(--avatar-${token}) 45%, var(--surface))`
const ink = 'color-mix(in srgb, var(--line-strong) 28%, transparent)'

/**
 * Chat backgrounds built from the design tokens, so every one of them
 * works in both the light and the dark theme.
 */
export function wallpaperStyle(id: string | undefined): CSSProperties | undefined {
  switch (id) {
    case 'sand':
    case 'sage':
    case 'sky':
    case 'rose':
    case 'plum':
      return { backgroundColor: tint(id) }
    case 'dots':
      return {
        backgroundColor: 'var(--surface)',
        backgroundImage: `radial-gradient(${ink} 1.2px, transparent 1.6px)`,
        backgroundSize: '20px 20px',
      }
    case 'grid':
      return {
        backgroundColor: 'var(--surface)',
        backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
        backgroundSize: '28px 28px',
      }
    case 'waves':
      return {
        backgroundColor: tint('sky'),
        backgroundImage: `radial-gradient(circle at 50% 100%, transparent 38%, ${ink} 40%, ${ink} 44%, transparent 46%)`,
        backgroundSize: '36px 18px',
      }
    default:
      return undefined
  }
}
