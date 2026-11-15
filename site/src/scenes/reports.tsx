import { ChevronRight } from 'lucide-react'
import { Roll, Stage, type Act } from '../kit'
import { AppFrame, Masthead } from '../parts'
import type { SceneProps } from './types'
import './reports.css'

// Reports: cash flow for six months, then October's expenses broken down. Food is opened, then
// Restaurants, down to its transactions; the breadcrumb and the total follow each step.
//
// Real strings: Reports, Cash flow, the months, Where it went, the breadcrumb, each level's rows
// and amounts, the transactions at the bottom.

type Level = 0 | 1 | 2
type S = { level: Level }

const initial: S = { level: 0 }
const POSTER: S = { level: 2 }

type Line = { name: string; amount: string; share: number; target?: string; sub?: string }
const LEVELS: { crumb: string; total: string; rows: Line[] }[] = [
  {
    crumb: 'Expenses',
    total: '$4,076.40',
    rows: [
      { name: 'Housing', amount: '$2,140.00', share: 1 },
      { name: 'Food', amount: '$1,236.15', share: 0.58, target: 'food' },
      { name: 'Transport', amount: '$412.25', share: 0.19 },
      { name: 'Fun', amount: '$288.00', share: 0.13 },
    ],
  },
  {
    crumb: 'Expenses › Food',
    total: '$1,236.15',
    rows: [
      { name: 'Groceries', amount: '$760.40', share: 1 },
      { name: 'Restaurants', amount: '$336.15', share: 0.44, target: 'restaurants' },
      { name: 'Coffee', amount: '$87.60', share: 0.12 },
      { name: 'Bakery', amount: '$52.00', share: 0.07 },
    ],
  },
  {
    crumb: 'Expenses › Food › Restaurants',
    total: '$336.15',
    rows: [
      { name: 'Kin Soy', sub: 'Oct 28 · Visa card', amount: '$53.15', share: 1 },
      { name: 'Pizza Night', sub: 'Oct 14 · Visa card', amount: '$41.80', share: 0.79 },
      { name: 'Uncle Boons', sub: 'Oct 21 · Visa card', amount: '$20.35', share: 0.38 },
    ],
  },
]

// Six months: income up in green, spending down in the pale blue, as the app draws it
const MONTHS = [
  { m: 'May', i: 0.78, o: 0.52 },
  { m: 'Jun', i: 0.8, o: 0.56 },
  { m: 'Jul', i: 0.76, o: 0.6 },
  { m: 'Aug', i: 0.74, o: 0.5 },
  { m: 'Sep', i: 0.98, o: 0.7 },
  { m: 'Oct', i: 0.82, o: 0.62 },
]

async function script(a: Act<S>) {
  await a.wait(1200)
  a.mark('food')
  await a.click({ at: 'food', x: a.layout === 'wide' ? 0.85 : 0.45, y: 0.5 })
  a.put({ level: 1 })
  await a.wait(1500)
  a.mark('restaurants')
  await a.click({ at: 'restaurants', x: a.layout === 'wide' ? 0.85 : 0.5, y: 0.5 })
  a.put({ level: 2 })
  await a.wait(3000)
  a.mark('end')
}

export default function ReportsScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 430 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 430, y: 168 }, compact: { x: 250, y: 120 } } }}
      className="lm lm-reports"
    >
      {(s, _rect, layout) => (
        <AppFrame layout={layout} url="books.example.com/reports" className="rp-win">
          <div className="lm-page rp-page">
            <Masthead word={layout === 'wide'} />
            <div className="rp-body" data-crop>
              <div className="lm-h1">Reports</div>

              {(
                <div className="lm-card rp-flow">
                  <div className="rp-flow__head">
                    <span className="lm-section">Cash flow</span>
                    <span className="rp-flow__net">+$1,842{layout === 'wide' ? ' in October' : ''}</span>
                  </div>
                  <div className="rp-chart" aria-hidden>
                    {MONTHS.map((x, i) => (
                      <div key={x.m} className="rp-month" data-on={i === MONTHS.length - 1 || undefined}>
                        <span className="rp-bar rp-bar--in" style={{ height: x.i * (layout === 'wide' ? 46 : 30) }} />
                        <span className="rp-bar rp-bar--out" style={{ height: x.o * (layout === 'wide' ? 30 : 18) }} />
                        <span className="rp-month__name">{x.m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="lm-card rp-break">
                <div className="rp-break__head">
                  <span className="rp-crumbs"><Roll>{layout === 'wide' ? LEVELS[s.level]!.crumb : LEVELS[s.level]!.crumb.split(' › ').slice(-2).join(' › ')}</Roll></span>
                  <span className="lm-amt rp-total"><Roll align="end">{LEVELS[s.level]!.total}</Roll></span>
                </div>
                <div className="rp-levels">
                  {LEVELS.map((lv, li) => (
                    <div key={li} className="rp-level" data-on={s.level === li || undefined} data-past={s.level > li || undefined}>
                      {lv.rows.map((r) => (
                        <div key={r.name} className="rp-row" data-target={s.level === li ? r.target : undefined}>
                          <span className="rp-row__text">
                            <span className="rp-row__name">{r.name}</span>
                            {r.sub && <span className="rp-row__sub">{r.sub}</span>}
                          </span>
                          <span className="lm-amt rp-row__amount">{r.amount}</span>
                          {!r.sub ? <ChevronRight className="rp-row__go" size={16} strokeWidth={2} /> : <span className="rp-row__go" />}
                          <span className="rp-row__track"><span className="rp-row__fill" style={{ transform: `scaleX(${s.level === li ? r.share : 0})` }} /></span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </AppFrame>
      )}
    </Stage>
  )
}
