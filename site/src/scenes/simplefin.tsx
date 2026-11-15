import { Check, CreditCard, Landmark, LineChart } from 'lucide-react'
import { Button, Collapse, Count, Field, Row, Spinner, Stage, States, type Act } from '../kit'
import { AppFrame, Masthead } from '../parts'
import type { SceneProps } from './types'
import './simplefin.css'

// Bank feeds through your own SimpleFIN connection. Bank connections: paste the setup token
// SimpleFIN Bridge gave you and Connect; the bank's accounts arrive one by one, each linked to an
// account in the book, and the count of transactions waiting in Review rolls up.
//
// Real strings: Bank connections, its line, SimpleFIN Bridge, Setup token, the token, Connect,
// the three accounts (name, the book's account, balance), the count.

type Phase = 'idle' | 'busy' | 'done'
type S = { focus: boolean; token: string; phase: Phase; open: boolean; shown: number; waiting: number }

const TOKEN = 'aHR0cHM6Ly9icmlkZ2Uuc2lt…'
const initial: S = { focus: false, token: '', phase: 'idle', open: false, shown: 0, waiting: 0 }
const POSTER: S = { focus: false, token: TOKEN, phase: 'done', open: true, shown: 3, waiting: 214 }

const ACCOUNTS = [
  { icon: <Landmark strokeWidth={2} />, name: 'Northwind Checking', book: 'Assets:Bank:Checking', amount: '$4,210.55' },
  { icon: <CreditCard strokeWidth={2} />, name: 'Northwind Visa', book: 'Liabilities:Visa', amount: '−$1,182.40' },
  { icon: <LineChart strokeWidth={2} />, name: 'Summit Brokerage', book: 'Assets:Investments:Summit', amount: '$38,904.12' },
]

async function script(a: Act<S>) {
  await a.wait(900)

  // 1. Paste the setup token
  a.mark('paste')
  await a.click({ at: 'token', x: 0.3, y: 0.55 })
  a.put({ focus: true })
  await a.wait(250)
  await a.key('cmd+v')
  a.put({ token: TOKEN })
  await a.wait(500)

  // 2. Connect
  a.mark('connect')
  await a.click({ at: 'connect', x: 0.8, y: 0.62 })
  a.put({ focus: false, phase: 'busy' })
  await a.wait(1100)
  a.put({ phase: 'done', open: true })
  await a.wait(250)

  // 3. The accounts arrive, linked; then what they brought in
  a.mark('accounts')
  for (let i = 1; i <= ACCOUNTS.length; i++) {
    a.put({ shown: i })
    await a.wait(260)
  }
  await a.wait(300)
  a.put({ waiting: 214 })
  await a.wait(2600)
  a.mark('end')
}

export default function SimplefinScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 460 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 520, y: 330 }, compact: { x: 300, y: 300 } } }}
      className="lm lm-simplefin"
    >
      {(s, _rect, layout) => (
        <AppFrame layout={layout} url="books.example.com" className="sf-win">
          <div className="lm-page sf-page">
            <Masthead word={layout === 'wide'} />
            <div className="sf-body" data-crop>
              <div className="lm-crumb">Accounts</div>
              <div className="lm-h1">Bank connections</div>
              {layout === 'wide' && <div className="lm-sub">Connections are yours, across your books; links are this book's.</div>}

              <div className="lm-card sf-connect">
                <div className="lm-section">SimpleFIN Bridge</div>
                <div className="sf-connect__row">
                  <Field
                    className="sf-token"
                    label="Setup token"
                    value={s.token}
                    placeholder="Paste it from SimpleFIN"
                    focused={s.focus}
                    box={{ 'data-target': 'token', 'data-cursor': 'ibeam' }}
                  />
                  <Button
                    className="lm-btn sf-go"
                    variant="primary"
                    data-target="connect"
                    icon={s.phase === 'idle' ? undefined : <States value={s.phase} states={{ busy: <Spinner size={16} />, done: <Check size={16} strokeWidth={2.5} /> }} />}
                  >
                    {s.phase === 'idle' ? 'Connect' : s.phase === 'busy' ? 'Connecting' : 'Connected'}
                  </Button>
                </div>
              </div>

              <Collapse open={!s.open}>
                <div className="lm-card sf-how">
                  <div className="lm-section">How to start</div>
                  <ol>
                    <li>Sign up at SimpleFIN Bridge and add your banks.</li>
                    <li>Make a setup token there.</li>
                    <li>Paste it here: your accounts come in, and sync every morning.</li>
                  </ol>
                </div>
              </Collapse>

              <Collapse open={s.open} reveal="drop">
                <div className="lm-card sf-accounts">
                  <div className="sf-accounts__head">
                    <span className="lm-section">Northwind Bank · Summit</span>
                    <span className="sf-waiting">
                      <Count value={s.waiting} duration={900} /> to review
                    </span>
                  </div>
                  <div className="lm-rows">
                    {ACCOUNTS.map((x, i) => (
                      <Collapse key={x.name} open={s.shown > i} reveal="drop">
                        <Row pad={14} lead={<span className="lm-tile">{x.icon}</span>} title={x.name} subtitle={x.book} meta={x.amount} />
                      </Collapse>
                    ))}
                  </div>
                </div>
              </Collapse>
            </div>
          </div>
        </AppFrame>
      )}
    </Stage>
  )
}
