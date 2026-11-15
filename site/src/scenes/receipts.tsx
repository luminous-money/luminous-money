import { ChevronDown, Paperclip } from 'lucide-react'
import { Badge, Collapse, Phone, Roll, Stage, type Act } from '../kit'
import { Masthead, PhoneScreen } from '../parts'
import type { SceneProps } from './types'
import './receipts.css'

// Receipts: a paper receipt beside the phone; the bank's charge for it waits in Review with no
// account. The camera is tapped; the receipt is read line by line, each item becoming a split
// with its own account, and the receipt's total matches the charge.
//
// Real strings: the receipt, Review, the charge (date, card, amount, the bank's payee and then
// the shop's), Choose an account, the four items with their accounts, Receipt matched.

type S = { read: number; named: boolean; matched: boolean }

const initial: S = { read: 0, named: false, matched: false }
const POSTER: S = { read: 4, named: true, matched: true }

const ITEMS = [
  { name: 'Oat milk', paper: 'OAT MILK', account: 'Food:Groceries', amount: '4.29' },
  { name: 'Sourdough loaf', paper: 'SOURDOUGH', account: 'Food:Groceries', amount: '6.50' },
  { name: 'Dish soap', paper: 'DISH SOAP', account: 'Household:Supplies', amount: '3.99' },
  { name: 'Coffee beans', paper: 'COFFEE BEANS', account: 'Food:Coffee', amount: '11.00' },
]

async function script(a: Act<S>) {
  await a.wait(1000)

  // 1. Capture: the camera in the masthead
  a.mark('capture')
  await a.click('camera')
  await a.wait(500)

  // 2. Read: the shop's name, then each item a split with its account
  a.mark('read')
  a.put({ named: true })
  await a.wait(450)
  for (let i = 1; i <= ITEMS.length; i++) {
    a.put({ read: i })
    await a.wait(420)
  }

  // 3. Its total matches the charge from the bank
  a.mark('match')
  await a.wait(250)
  a.put({ matched: true })
  await a.wait(2800)
  a.mark('end')
}

export default function ReceiptsScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 540 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      cursor={{ at: { wide: { x: 560, y: 560 }, compact: { x: 300, y: 510 } }, style: 'touch' }}
      className="lm lm-receipts"
    >
      {(s, _rect, layout) => {
        const screen = (
          <div className="rc-app lm-page">
            <Masthead camera />
            <div className="rc-body" data-crop>
              <div className="lm-crumb">Home</div>
              <div className="lm-h1">Review</div>
              <div className="lm-card rc-card">
                <div className="rc-top">
                  <span className="rc-when">Nov 9 · Visa card</span>
                  <span className="lm-amt rc-amount">−$25.78</span>
                </div>
                <div className="rc-payee">
                  <Roll>{s.named ? 'Good Moods Market' : 'GOOD MOODS MKT #114'}</Roll>
                </div>
                <Collapse open={s.read === 0}>
                  <div className="rc-account">
                    Choose an account
                    <ChevronDown size={16} strokeWidth={2} />
                  </div>
                </Collapse>
                <div className="rc-splits">
                  {ITEMS.map((x, i) => (
                    <Collapse key={x.name} open={s.read > i}>
                      <div className="rc-split">
                        <span className="rc-split__text">
                          <span className="rc-split__name">{x.name}</span>
                          <span className="rc-split__account">{x.account}</span>
                        </span>
                        <span className="lm-amt rc-split__amount">${x.amount}</span>
                      </div>
                    </Collapse>
                  ))}
                </div>
                <Collapse open={s.matched} reveal="drop">
                  <div className="rc-matched">
                    <Badge tone="success" icon={<Paperclip size={14} strokeWidth={2.25} />}>Receipt matched</Badge>
                  </div>
                </Collapse>
              </div>
              <div className="lm-card rc-card rc-next">
                <div className="rc-top">
                  <span className="rc-when">Nov 8 · Checking</span>
                  <span className="lm-amt rc-amount">−$54.10</span>
                </div>
                <div className="rc-payee">City Power &amp; Light</div>
                <div className="rc-account rc-account--set">
                  Housing:Utilities
                  <ChevronDown size={16} strokeWidth={2} />
                </div>
              </div>
            </div>
          </div>
        )
        return (
          <>
            {layout === 'wide' ? (
              <Phone width={340} className="rc-phone" wallpaper="#f3f4f6">{screen}</Phone>
            ) : (
              <PhoneScreen>{screen}</PhoneScreen>
            )}
            {layout === 'wide' && <Paper read={s.read} matched={s.matched} />}
          </>
        )
      }}
    </Stage>
  )
}

function Paper({ read, matched }: { read: number; matched: boolean }) {
  return (
    <div className="rc-paper" aria-hidden>
      <div className="rc-paper__shop">GOOD MOODS MARKET</div>
      <div className="rc-paper__faint">114 ELM ST · 11/09/26 6:42 PM</div>
      <div className="rc-paper__rule" />
      {ITEMS.map((x, i) => (
        <div key={x.paper} className="rc-paper__line" data-lit={(read === i + 1 && !matched) || undefined}>
          <span>{x.paper}</span>
          <span>{x.amount}</span>
        </div>
      ))}
      <div className="rc-paper__rule" />
      <div className="rc-paper__line rc-paper__total" data-lit={matched || undefined}>
        <span>TOTAL</span>
        <span>25.78</span>
      </div>
      <div className="rc-paper__faint">VISA ••••4021</div>
      <div className="rc-paper__faint">AUTH 044172</div>
      <div className="rc-paper__rule" />
      <div className="rc-paper__faint">ITEMS 4 · THANK YOU</div>
      <div className="rc-paper__faint">GOODMOODS.EXAMPLE</div>
    </div>
  )
}
