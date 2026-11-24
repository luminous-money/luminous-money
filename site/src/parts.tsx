import { Bell, Camera, ChevronDown, Menu } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Phone, Window, type Layout } from './kit'
import { FILLED, OUTLINE } from './logo-paths'

/** The Lu logo: the filled tile (on light), or the white outline (on the product's blue). */
export function Logo({ size = 36, outline = false, style, className }: { size?: number; outline?: boolean; style?: CSSProperties; className?: string }) {
  if (outline)
    return (
      <svg viewBox="0 0 16.933334 16.933334" width={size} height={size} style={style} className={className} aria-hidden>
        <g transform="scale(0.142903)" fill="#fff">
          <rect x="5.953125" y="5.953125" width="106.58929" height="106.58929" rx="7.9375" fill="none" stroke="#fff" strokeWidth="6.6145835" />
          <path d={OUTLINE} />
        </g>
      </svg>
    )
  return (
    <svg viewBox="0.023386 0.025193 16.933334 16.933334" width={size} height={size} style={style} className={className} aria-hidden>
      <defs>
        <linearGradient id="lu-blue" gradientUnits="userSpaceOnUse" x1="0.023386" y1="0.025193" x2="16.95672" y2="16.958523">
          <stop offset="0" stopColor="#0062a8" />
          <stop offset="1" stopColor="#003052" />
        </linearGradient>
      </defs>
      <rect x="0.023386" y="0.025193" width="16.933334" height="16.933334" rx="2.6458333" fill="url(#lu-blue)" />
      <path fill="#fff" d={FILLED} />
    </svg>
  )
}

/** The app's masthead: the logo (with its name when there's room), the bell, the book and the menu. */
export function Masthead({ word = false, book = 'Household', camera = false }: { word?: boolean; book?: string; camera?: boolean }) {
  return (
    <div className="lm-mast">
      <Logo size={36} className="lm-mast__logo" />
      {word && <span className="lm-mast__word">Luminous Money</span>}
      <span className="lm-mast__space" />
      {camera && <span className="lm-mast__icon" data-target="camera"><Camera strokeWidth={1.75} /></span>}
      <span className="lm-mast__icon"><Bell strokeWidth={1.75} /></span>
      <span className="lm-book">{book}<ChevronDown strokeWidth={2.5} /></span>
      <span className="lm-mast__icon"><Menu strokeWidth={1.75} /></span>
    </div>
  )
}

/** Dollars as the app writes them: $1,234.56, a minus before the sign. */
export function money(n: number, cents = true) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
  return `${n < 0 ? '−' : ''}$${s}`
}

/** The app on a phone's bare screen, for compact designs: in a phone's column, the app is the
 * screen. 326 wide, a gutter from the tile's sides, running off its bottom. */
export function PhoneScreen({ className, wallpaper = '#f3f4f6', children }: { className?: string; wallpaper?: string; children: ReactNode }) {
  return (
    <Phone frame="bare" status width={326} wallpaper={wallpaper} className={`lm-bare${className ? ` ${className}` : ''}`}>
      {children}
    </Phone>
  )
}

/** The app in a browser window (wide), or on a phone's bare screen (compact): a desktop window
 * squeezed narrow would read as a squashed app. */
export function AppFrame({ layout, url, className, children }: { layout: Layout; url: ReactNode; className: string; children: ReactNode }) {
  if (layout === 'compact') return <PhoneScreen className={className}>{children}</PhoneScreen>
  return (
    <Window url={url} urlShape="pill" className={`lm-browser ${className}`}>
      {children}
    </Window>
  )
}
