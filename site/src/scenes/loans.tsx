import { Check } from 'lucide-react'
import { Badge, Button, Collapse, Count, Field, Roll, Stage, type Act } from '../kit'
import { AppFrame, Masthead, money } from '../parts'
import type { SceneProps } from './types'
import './loans.css'

// Loans: a mortgage's page, kept from its amortization table: what's owed today, when it's paid
// off, and the next payment in its parts. Pay extra takes $5,000 toward principal; what's owed
// rolls down, the payoff date comes in, and the page says what that saves.
//
// Real strings: Loans, Mortgage and its terms, Owed today, Paid off, Next payment and its three
// parts, Pay extra, Extra principal, Pay, the savings.

type S = { form: boolean; amount: string; paid: boolean }

const initial: S = { form: false, amount: '', paid: false }
const POSTER: S = { form: false, amount: '5,000', paid: true }

const PARTS = [
  { name: 'Principal', amount: 612.1, cls: 'principal' },
  { name: 'Interest', amount: 1186.52, cls: 'interest' },
  { name: 'Escrow', amount: 350, cls: 'escrow' },
]
const TOTAL = PARTS.reduce((t, p) => t + p.amount, 0)

async function script(a: Act<S>) {
  await a.wait(1000)
  a.mark('extra')
  await a.click({ at: 'extra', x: 0.75, y: 0.6 })
  a.put({ form: true })
  await a.wait(600)
  await a.click({ at: 'amount', x: 0.4, y: 0.5 })
  await a.type('amount', '5,000', { interval: 110 })
  await a.wait(350)
  a.mark('pay')
  await a.click({ at: 'pay', x: 0.7, y: 0.6 })
  a.put({ form: false })
  await a.wait(300)
  a.put({ paid: true })
  // Out of the way of the figures that change
  await a.move({ x: a.layout === 'wide' ? 430 : 250, y: a.layout === 'wide' ? 175 : 130 })
  await a.wait(2400)
  a.mark('end')
}

export default function LoansScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 460 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 430, y: 175 }, compact: { x: 250, y: 130 } } }}
      className="lm lm-loans"
    >
      {(s, _rect, layout) => (
        <AppFrame layout={layout} url="books.example.com/loans" className="ln-win">
          <div className="lm-page ln-page">
            <Masthead word={layout === 'wide'} />
            <div className="ln-body" data-crop>
              <div className="lm-crumb">Loans</div>
              <div className="lm-h1">Mortgage</div>
              <div className="lm-sub">Northwind Bank · 6.125% · 30 years</div>

              <div className="lm-card ln-owed">
                <div className="ln-owed__top">
                  <span className="lm-section">Owed today</span>
                  <Button className="lm-btn" size="small" data-target="extra">Pay extra</Button>
                </div>
                <div className="ln-owed__big lm-amt">
                  <Count value={s.paid ? 279112.4 : 284112.4} format={(n) => money(n)} duration={900} stagger={40} />
                </div>
                <div className="ln-owed__when">
                  Paid off <Roll>{s.paid ? 'Aug 2050' : 'Mar 2052'}</Roll>
                </div>
                <Collapse open={s.paid} reveal="drop">
                  <div className="ln-saved">
                    <Badge tone="success" icon={<Check size={14} strokeWidth={2.5} />}>Saves $31,840 in interest</Badge>
                  </div>
                </Collapse>
                <Collapse open={s.form}>
                  <div className="ln-form">
                    <Field className="ln-amount" label="Extra principal" value={s.amount ? `$${s.amount}` : ''} placeholder="$0.00" focused={s.form && !!s.amount} box={{ 'data-target': 'amount' }} />
                    <Button className="lm-btn ln-pay" variant="primary" data-target="pay">Pay</Button>
                  </div>
                </Collapse>
              </div>

              <div className="lm-card ln-next">
                <div className="ln-next__top">
                  <span className="lm-section">Next payment · Dec 1</span>
                  <span className="lm-amt ln-next__total">{money(TOTAL)}</span>
                </div>
                <div className="ln-parts" aria-hidden>
                  {PARTS.map((p) => <span key={p.name} className={`ln-part ln-part--${p.cls}`} style={{ flexGrow: p.amount }} />)}
                </div>
                {PARTS.map((p) => (
                  <div key={p.name} className="ln-legend">
                    <span className={`ln-key ln-part--${p.cls}`} />
                    <span className="ln-legend__name">{p.name}</span>
                    <span className="lm-amt ln-legend__amt">{money(p.amount)}</span>
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
