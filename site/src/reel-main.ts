// The reel's entry. Recording (?record) puts the page on the kit's virtual clock before React
// or any scene loads, so scripts/record.mjs moves time one video frame at a time.
import { installVirtualClock } from './kit/clock'

if (new URLSearchParams(location.search).has('record')) {
  installVirtualClock({ fps: 30, epoch: Date.UTC(2026, 10, 14, 15, 0, 0) })
}
// Geist before the first render: labels are measured as they mount
await import('@fontsource-variable/geist')
await Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 15px "Geist Variable"`)))
await import('./reel')
