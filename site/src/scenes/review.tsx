import { Check, ChevronDown, Search, SlidersHorizontal } from 'lucide-react'
import { Button, Collapse, Count, Phone, Stage, type Act } from '../kit'
import { Masthead, PhoneScreen } from '../parts'
import type { SceneProps } from './types'
import './review.css'

// Mobile-first: Review on a phone. The queue's first card already has its account (history
// suggested it); a finger swipes it right, the blue Confirm opens behind it, and it's thrown off
// the screen; the gap closes, the next card moves up and "22 left" rolls to 21.
//
// Real strings: Review, Household · 22 left, the two cards (date and account, payee, what it was,
// the account it goes to, the amount), Skip / Split… / Confirm, Confirm behind the card.

type S = { dx: number; throw: { ms: number; ease: string } | null; away: boolean; gone: boolean; removed: boolean; left: number }

const initial: S = { dx: 0, throw: null, away: false, gone: false, removed: false, left: 22 }
const POSTER: S = { dx: 0, throw: null, away: true, gone: true, removed: true, left: 21 }

// Screen points across: the phone's (wide), or the bare screen's (compact)
const POINTS = { wide: 402, compact: 326 }
// A swipe past this many points arms Confirm, as the app's does
const ARM = 90

const CARDS = [
  { when: 'Nov 9 · Visa card', amount: '−$67.47', payee: 'Good Moods Market', what: 'Buying groceries', account: 'Food:Groceries' },
  { when: 'Nov 9 · Visa card', amount: '−$20.35', payee: 'Uncle Boons', what: 'Eating out with Bill', account: 'Food:Restaurants' },
  { when: 'Nov 8 · Checking', amount: '−$54.10', payee: 'City Power & Light', what: 'Electric bill', account: 'Housing:Utilities' },
]

async function script(a: Act<S>) {
  await a.wait(1100)

  // 1. Press the card on its left half, then swipe it right
  a.mark('swipe')
  const card = a.rect('card')
  const y = card.y + card.height * 0.42
  const from = card.x + card.width * 0.22
  await a.move({ x: from, y })
  await a.wait(220)
  const samples: { x: number; t: number }[] = []
  await a.drag(
    { x: card.x + card.width * 0.8, y },
    (at) => {
      samples.push({ x: at.x, t: performance.now() })
      a.put({ dx: at.x - from })
    },
    { duration: 420, path: (t, p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y }) },
  )

  // 2. The finger lifts still moving; the card carries on off the screen at that speed
  a.mark('throw')
  const last = samples.slice(-4)
  const v = last.length > 1 ? Math.abs(last[last.length - 1]!.x - last[0]!.x) / Math.max(1, last[last.length - 1]!.t - last[0]!.t) : 1
  const dx = samples.length ? samples[samples.length - 1]!.x - from : 0
  const travel = card.width * 1.25 - dx
  const ms = 260
  const x1 = 0.25
  const y1 = Math.min(0.95, (x1 * v * ms) / Math.max(1, travel))
  a.put({ throw: { ms, ease: `cubic-bezier(${x1}, ${y1.toFixed(3)}, 0.35, 1)` }, dx: card.width * 1.25 })
  await a.wait(ms)
  // Past the screen's edge now, out of sight: the fold below doesn't carry it
  a.put({ away: true })
  await a.wait(40)

  // 3. The gap closes, the next card moves up, and the count rolls
  a.mark('close')
  a.put({ gone: true })
  await a.wait(260)
  a.put({ left: 21 })
  // Folded away: the confirmed card leaves the list for good
  await a.wait(500)
  a.put({ removed: true })
  await a.wait(2100)
  a.mark('end')
}

export default function ReviewScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 460 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 470, y: 560 }, compact: { x: 280, y: 430 } }, style: 'touch' }}
      className="lm lm-review"
    >
      {(s, rect, layout) => {
        const box = rect('screen')
        const k = box.width ? box.width / POINTS[layout] : 1
        const shift = s.dx / k
        const armed = shift > ARM
        const screen = (
          <div className="rv-app lm-page" data-target="screen">
            <Masthead />
            <div className="rv-body" data-crop>
              <div className="lm-crumb">Home</div>
              <div className="lm-h1">Review</div>
              <div className="lm-sub">
                Household · <Count value={s.left} duration={520} /> left
              </div>
              <div className="rv-tools">
                <span className="rv-search"><Search size={16} strokeWidth={2} />Search</span>
                <Button className="lm-btn">Select</Button>
                <span className="rv-filter"><SlidersHorizontal size={18} strokeWidth={1.75} /></span>
              </div>
              {!s.removed && <Collapse open={!s.gone} solid>
                <div className="rv-swipe">
                  {(s.dx !== 0 || s.throw) && (
                    <div className="rv-under" data-armed={armed || undefined}>
                      <span><Check size={20} strokeWidth={2.5} />Confirm</span>
                    </div>
                  )}
                  <div
                    className="rv-surface"
                    data-target="card"
                    style={{
                      visibility: s.away ? 'hidden' : undefined,
                      transform: `translateX(${shift}px) rotate(${Math.min(6, shift * 0.018)}deg)`,
                      transition: s.throw ? `transform ${s.throw.ms}ms ${s.throw.ease}` : 'none',
                    }}
                  >
                    <ReviewCard c={CARDS[0]!} />
                  </div>
                </div>
              </Collapse>}
              <div className="rv-swipe">
                <ReviewCard c={CARDS[1]!} />
              </div>
              <div className="rv-swipe">
                <ReviewCard c={CARDS[2]!} />
              </div>
            </div>
          </div>
        )
        return layout === 'wide' ? (
          <Phone width={372} className="rv-phone" wallpaper="#f3f4f6">{screen}</Phone>
        ) : (
          <PhoneScreen>{screen}</PhoneScreen>
        )
      }}
    </Stage>
  )
}

function ReviewCard({ c }: { c: (typeof CARDS)[number] }) {
  return (
    <div className="rv-card lm-card">
      <div className="rv-card__top">
        <span className="rv-when">{c.when}</span>
        <span className="lm-amt rv-amount">{c.amount}</span>
      </div>
      <div className="rv-payee">{c.payee}</div>
      <div className="rv-what">{c.what}</div>
      <div className="rv-account">
        {c.account}
        <ChevronDown size={16} strokeWidth={2} />
      </div>
      <div className="rv-tags">Add a tag</div>
      <div className="rv-actions">
        <Button className="lm-btn">Skip</Button>
        <Button className="lm-btn">Split…</Button>
        <span className="rv-grow" />
        <Button className="lm-btn" variant="primary">Confirm</Button>
      </div>
    </div>
  )
}
