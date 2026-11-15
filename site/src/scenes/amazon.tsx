import { Check, Package, RefreshCw } from 'lucide-react'
import { Button, Collapse, Count, Spinner, Stage, States, type Act } from '../kit'
import { AppFrame, Masthead } from '../parts'
import type { SceneProps } from './types'
import './amazon.css'

// Amazon orders: Sync now reads the newest order, and the card's charge for it comes in
// itemized, each item a split with its own account, the three adding up to the charge.
//
// Real strings: Amazon, its line, Sync, the account, Sync now, Charges read and its count, the
// new charge (date, card, amount, order) with its three items, the two older charges.

type Phase = 'idle' | 'busy' | 'done'
type S = { phase: Phase; arrived: boolean; items: number; read: number }

const initial: S = { phase: 'idle', arrived: false, items: 0, read: 3 }
const POSTER: S = { phase: 'done', arrived: true, items: 3, read: 4 }

const ITEMS = [
  { name: 'USB-C cable, 2-pack', account: 'Electronics:Accessories', amount: '$12.99' },
  { name: 'The Overstory, paperback', account: 'Fun:Books', amount: '$18.40' },
  { name: 'Kitchen scale', account: 'Household:Kitchen', amount: '$52.78' },
]

async function script(a: Act<S>) {
  await a.wait(900)
  a.mark('sync')
  await a.click({ at: 'sync', x: 0.8, y: 0.62 })
  a.put({ phase: 'busy' })
  await a.wait(1300)

  // The new charge drops in, then opens into its items
  a.mark('arrive')
  a.put({ phase: 'done', arrived: true, read: 4 })
  await a.wait(600)
  for (let i = 1; i <= ITEMS.length; i++) {
    a.put({ items: i })
    await a.wait(380)
  }
  await a.wait(2700)
  a.mark('end')
}

export default function AmazonScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 460 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 340, y: 290 }, compact: { x: 180, y: 300 } } }}
      className="lm lm-amazon"
    >
      {(s, _rect, layout) => (
        <AppFrame layout={layout} url="books.example.com" className="az-win">
          <div className="lm-page az-page">
            <Masthead word={layout === 'wide'} />
            <div className="az-body" data-crop>
              <div className="lm-crumb">Accounts</div>
              <div className="lm-h1">Amazon</div>
              {layout === 'wide' && <div className="lm-sub">Each charge itemized, in the card's own transaction.</div>}

              <div className="lm-card az-sync">
                <div className="az-sync__text">
                  <div className="lm-section">Sync</div>
                  <div className="az-sync__who">you@example.com</div>
                </div>
                <Button
                  className="lm-btn az-go"
                  data-target="sync"
                  icon={
                    <States
                      value={s.phase}
                      states={{ idle: <RefreshCw size={16} strokeWidth={2.25} />, busy: <Spinner size={16} />, done: <Check size={16} strokeWidth={2.5} /> }}
                    />
                  }
                >
                  {s.phase === 'idle' ? 'Sync now' : s.phase === 'busy' ? 'Reading' : 'Synced'}
                </Button>
              </div>

              <div className="lm-card az-charges">
                <div className="az-charges__head lm-section">
                  Charges read (<Count value={s.read} duration={500} />)
                </div>
                <Collapse open={s.arrived} reveal="drop">
                  <div className="az-charge" data-new>
                    <div className="az-charge__top">
                      <span className="lm-tile"><Package strokeWidth={2} /></span>
                      <span className="az-charge__text">
                        <span className="az-charge__title">Nov 12 · Visa card</span>
                        <span className="az-charge__sub">Order 112-4471029 · 3 items</span>
                      </span>
                      <span className="lm-amt az-charge__amount">−$84.17</span>
                    </div>
                    <div className="az-items">
                      {ITEMS.map((x, i) => (
                        <Collapse key={x.name} open={s.items > i}>
                          <div className="az-item">
                            <span className="az-item__text">
                              <span className="az-item__name">{x.name}</span>
                              <span className="az-item__account">{x.account}</span>
                            </span>
                            <span className="lm-amt az-item__amount">{x.amount}</span>
                          </div>
                        </Collapse>
                      ))}
                    </div>
                  </div>
                </Collapse>
                {[
                  { title: 'Nov 3 · Visa card', sub: 'Order 112-9930417 · 2 items', amount: '−$31.48' },
                  { title: 'Oct 29 · Checking', sub: 'Order 112-0218844 · 1 item', amount: '−$15.99' },
                  { title: 'Oct 21 · Visa card', sub: 'Order 112-6605172 · 4 items', amount: '−$62.05' },
                ].map((c) => (
                  <div key={c.title} className="az-charge">
                    <div className="az-charge__top">
                      <span className="lm-tile"><Package strokeWidth={2} /></span>
                      <span className="az-charge__text">
                        <span className="az-charge__title">{c.title}</span>
                        <span className="az-charge__sub">{c.sub}</span>
                      </span>
                      <span className="lm-amt az-charge__amount">{c.amount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </AppFrame>
      )}
    </Stage>
  )
}
