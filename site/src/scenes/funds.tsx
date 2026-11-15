import { Plus } from 'lucide-react'
import { Button, Count, Field, Phone, Stage, type Act } from '../kit'
import { Masthead, PhoneScreen, money } from '../parts'
import type { SceneProps } from './types'
import './funds.css'

// Budgets and funds on a phone: this month's budgets (one over), then the funds with their
// goals. Add on Vacation opens Move money; $500 is typed and moved, and Vacation's goal fills
// while what's unallocated goes down by as much.
//
// Real strings: Plan, Budgets and funds, the two budgets, Funds and what's unallocated, the three
// funds with their goals, Move money to Vacation, From Unallocated, Amount, Move.

type S = { open: boolean; amount: string; moved: boolean }

const initial: S = { open: false, amount: '', moved: false }
const POSTER: S = { open: false, amount: '500', moved: true }

const FUNDS = [
  { name: 'Emergency', have: 8000, goal: 10000 },
  { name: 'Vacation', have: 1250, goal: 3000, target: true },
  { name: 'New car', have: 4600, goal: 20000 },
]

async function script(a: Act<S>) {
  await a.wait(1000)
  a.mark('add')
  await a.click('add')
  a.put({ open: true })
  await a.wait(700)
  await a.click({ at: 'amount', x: 0.5, y: 0.5 })
  await a.type('amount', '500', { interval: 140 })
  await a.wait(400)
  a.mark('move')
  await a.click('move')
  a.put({ open: false })
  await a.wait(250)
  a.put({ moved: true })
  await a.wait(3000)
  a.mark('end')
}

export default function FundsScene({ play = 'once' }: SceneProps) {
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
      className="lm lm-funds"
    >
      {(s, _rect, layout) => {
        const unallocated = 3420.16 - (s.moved ? 500 : 0)
        const screen = (
          <div className="fd-app lm-page">
            <Masthead />
            <div className="fd-body" data-crop>
              <div className="lm-crumb">Plan</div>
              <div className="lm-h1">Budgets and funds</div>

              <div className="lm-card fd-card fd-budgets">
                <div className="fd-head">
                  <span className="lm-section">Budgets · November</span>
                </div>
                <Budget name="Groceries" spent={612} limit={800} />
                <Budget name="Dining out" spent={388} limit={300} />
              </div>

              <div className="lm-card fd-card fd-funds">
                <div className="fd-head">
                  <span className="lm-section">Funds</span>
                  <span className="fd-free">
                    <Count value={unallocated} format={(n) => money(n)} duration={800} /> free
                  </span>
                </div>
                {FUNDS.map((f) => {
                  const have = f.have + (f.target && s.moved ? 500 : 0)
                  return (
                    <div key={f.name} className="fd-line">
                      <div className="fd-line__top">
                        <span className="fd-line__name">{f.name}</span>
                        <span className="lm-amt fd-line__amt">
                          <Count value={have} format={(n) => money(n, false)} duration={800} />
                          <span className="fd-of"> of {money(f.goal, false)}</span>
                        </span>
                        {f.target ? (
                          <span className="fd-add" data-target="add"><Plus size={18} strokeWidth={2.25} /></span>
                        ) : (
                          <span className="fd-add fd-add--quiet"><Plus size={18} strokeWidth={2.25} /></span>
                        )}
                      </div>
                      <span className="fd-note"><Count value={Math.round((have / f.goal) * 100)} format={(n) => `${Math.round(n)}%`} duration={800} /> of the goal</span>
                      <span className="fd-track"><span className="fd-fill" style={{ transform: `scaleX(${have / f.goal})` }} /></span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="fd-scrim" data-open={s.open || undefined} />
            <div className="fd-dialog lm-card" data-open={s.open || undefined}>
              <div className="fd-dialog__title">Move money to Vacation</div>
              <div className="fd-dialog__from">From <b>Unallocated</b> · {money(3420.16)}</div>
              <Field label="Amount" value={s.amount ? `$${s.amount}` : ''} placeholder="$0.00" focused={s.open && !!s.amount} box={{ 'data-target': 'amount' }} />
              <div className="fd-dialog__actions">
                <Button className="lm-btn">Cancel</Button>
                <Button className="lm-btn" variant="primary" data-target="move">Move</Button>
              </div>
            </div>
          </div>
        )
        return layout === 'wide' ? (
          <Phone width={372} className="fd-phone" wallpaper="#f3f4f6">{screen}</Phone>
        ) : (
          <PhoneScreen>{screen}</PhoneScreen>
        )
      }}
    </Stage>
  )
}

function Budget({ name, spent, limit }: { name: string; spent: number; limit: number }) {
  const over = spent > limit
  return (
    <div className="fd-line">
      <div className="fd-line__top">
        <span className="fd-line__name">{name}</span>
        <span className="lm-amt fd-line__amt" data-over={over || undefined}>
          {money(spent, false)}<span className="fd-of"> of {money(limit, false)}</span>
        </span>
      </div>
      <span className="fd-note" data-over={over || undefined}>{over ? `${money(spent - limit, false)} over` : `${money(limit - spent, false)} left`}</span>
      <span className="fd-track"><span className="fd-fill" data-over={over || undefined} style={{ transform: `scaleX(${Math.min(1, spent / limit)})` }} /></span>
    </div>
  )
}
