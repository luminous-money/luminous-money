import { Check, ChevronDown } from 'lucide-react'
import { Button, Field, Roll, Stage, States, type Act } from '../kit'
import { AppFrame, Masthead } from '../parts'
import type { SceneProps } from './types'
import './ai.css'

// Bring your own AI: the AI page, where your Anthropic API key goes (optional; the page says so).
// The key is pasted and saved; then, in Review's Select mode, "Categorize with AI" fills in the
// accounts of three transactions nothing else knew, and says what it cost.
//
// Real strings: AI, its line, Anthropic, API key, Save/Saved, what it turns on; Review, 3
// selected, Categorize with AI, the three transactions and the accounts they get, the cost.

type S = { focus: boolean; key: string; saved: boolean; page: 'ai' | 'review'; asking: boolean; filled: number; cost: boolean }

const KEY = 'sk-ant-api03-7Qd2xK9vLm4pRt8wZc1N'
const initial: S = { focus: false, key: '', saved: false, page: 'ai', asking: false, filled: 0, cost: false }
const POSTER: S = { focus: false, key: KEY, saved: true, page: 'review', asking: false, filled: 3, cost: true }

const ROWS = [
  { when: 'Nov 10', payee: 'Blue Bottle Coffee', amount: '−$6.75', account: 'Food:Coffee' },
  { when: 'Nov 10', payee: 'Lyft', amount: '−$18.40', account: 'Transport:Rideshare' },
  { when: 'Nov 9', payee: 'Bandcamp', amount: '−$12.00', account: 'Fun:Music' },
]

async function script(a: Act<S>) {
  await a.wait(900)

  // 1. Paste the key, Save
  a.mark('key')
  await a.click({ at: 'key', x: 0.3, y: 0.55 })
  a.put({ focus: true })
  await a.wait(250)
  await a.key('cmd+v')
  a.put({ key: KEY })
  await a.wait(500)
  await a.click({ at: 'save', x: 0.75, y: 0.6 })
  a.put({ focus: false, saved: true })
  await a.wait(1500)

  // 2. Over to Review, where three transactions are selected, waiting for an account
  a.mark('review')
  a.put({ page: 'review' })
  await a.wait(900)
  await a.click({ at: 'ask', x: 0.8, y: 0.62 })
  a.put({ asking: true })
  await a.wait(700)

  // 3. Claude's answers land, one by one, and what it cost
  a.mark('answers')
  for (let i = 1; i <= ROWS.length; i++) {
    a.put({ filled: i })
    await a.wait(320)
  }
  a.put({ asking: false, cost: true })
  await a.wait(2600)
  a.mark('end')
}

export default function AiScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 460 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 470, y: 420 }, compact: { x: 280, y: 400 } } }}
      className="lm lm-ai"
    >
      {(s, _rect, layout) => (
        <AppFrame layout={layout} url={<>books.example.com/<Roll>{s.page}</Roll></>} className="ai-win">
          <div className="lm-page ai-page">
            <Masthead word={layout === 'wide'} />
            <div className="ai-pages" data-crop>
              <div className="ai-body" data-on={s.page === 'ai' || undefined}>
                <div className="lm-crumb">Automation</div>
                <div className="lm-h1">AI</div>
                <div className="lm-sub">Optional. Without a key, your rules and history still categorize.</div>
                <div className="lm-card ai-card">
                  <div className="lm-section">Anthropic</div>
                  <div className="ai-row">
                    <Field
                      className="ai-key"
                      label="API key"
                      value={s.key}
                      password
                      placeholder="sk-ant-…"
                      focused={s.focus}
                      box={{ 'data-target': 'key', 'data-cursor': 'ibeam' }}
                    />
                    <Button className="lm-btn ai-save" variant="primary" data-target="save" icon={s.saved ? <Check size={16} strokeWidth={2.5} /> : undefined}>
                      {s.saved ? 'Saved' : 'Save'}
                    </Button>
                  </div>
                  <ul className="ai-uses">
                    <li>Reads receipts into itemized transactions</li>
                    <li>Suggests accounts in Review, split by split</li>
                    <li>Shows what each request cost</li>
                  </ul>
                </div>
                <div className="lm-card ai-month">
                  <div className="lm-section">This month</div>
                  <div className="ai-month__row">
                    <span><b>0</b> receipts read</span>
                    <span><b>0</b> suggestions</span>
                    <span><b>$0.00</b> spent</span>
                  </div>
                </div>
              </div>

              <div className="ai-body" data-on={s.page === 'review' || undefined}>
                <div className="lm-crumb">Home</div>
                <div className="lm-h1">Review</div>
                <div className="ai-select">
                  <span className="ai-select__count"><Roll>{s.cost ? '3 categorized · $0.004' : '3 selected'}</Roll></span>
                  <Button
                    className="lm-btn"
                    variant="primary"
                    data-target="ask"
                    icon={s.asking ? <States value="busy" states={{ busy: <span className="ai-dots"><i /><i /><i /></span> }} /> : undefined}
                  >
                    Categorize with AI
                  </Button>
                </div>
                <div className="lm-card ai-list">
                  {ROWS.map((r, i) => (
                    <div className="ai-item" key={r.payee}>
                      <span className="ai-tick"><Check size={14} strokeWidth={3} /></span>
                      <span className="ai-item__text">
                        <span className="ai-item__payee">{r.payee}</span>
                        <span className="ai-item__when">{r.when} · Visa card</span>
                      </span>
                      <span className="lm-amt ai-item__amount">{r.amount}</span>
                      <span className="ai-pick" data-set={s.filled > i || undefined}>
                        <Roll variant="fade">{s.filled > i ? r.account : 'Choose an account'}</Roll>
                        <ChevronDown size={15} strokeWidth={2} />
                      </span>
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
