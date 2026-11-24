import { Check } from 'lucide-react'
import { Bar, Collapse, Field, Stage, States, Stream, Window, type Act } from '../kit'
import { Logo, PhoneScreen } from '../parts'
import type { SceneProps } from './types'
import './claude.css'

// Claude, connected to the books (the MCP server): a question about October's restaurants is
// answered from the budget and the report, read through Luminous Money's tools; then a follow-up
// tags the biggest one, a write done as the user. claude.ai in the browser on the wide design, the
// phone on the compact one (where Kael uses it). The figures are the reports scene's.
//
// Real strings: the two questions, the tools each used, the two answers.

type S = { draft: string; sent: number; tools: number; words: number[] }

const TURNS = [
  {
    q: 'How did we do on restaurants in October?',
    tools: ['read_budget_status', 'read_report'],
    a: 'You spent $336.15 at restaurants in October, $63.85 under your $400 budget. The biggest was Kin Soy on Oct 28, at $53.15.',
  },
  {
    q: 'Tag that one #date-night',
    tools: ['write_edit_transaction'],
    a: 'Done: #date-night is on Kin Soy, Oct 28.',
  },
]
const WORDS = TURNS.map((t) => t.a.split(' ').length)
// The tools before each turn's, counted across the thread
const BEFORE = TURNS.map((_, i) => TURNS.slice(0, i).reduce((n, t) => n + t.tools.length, 0))
const ALL_TOOLS = BEFORE[TURNS.length - 1]! + TURNS[TURNS.length - 1]!.tools.length

// Earlier exchanges, as filler: the window starts full, and they go up out of it as this one grows
const PAST = [
  { q: 170, lines: ['84%', '90%', '76%', '52%'] },
  { q: 240, lines: ['80%', '86%', '44%'] },
  { q: 210, lines: ['88%', '64%'] },
]

// Claude's warm paper, not the app's gray
const PAPER = '#faf9f7'

const initial: S = { draft: '', sent: 0, tools: 0, words: [0, 0] }
const POSTER: S = { draft: '', sent: 2, tools: ALL_TOOLS, words: WORDS }

async function script(a: Act<S>) {
  await a.wait(700)
  for (let t = 0; t < TURNS.length; t++) {
    const turn = TURNS[t]!
    a.mark(`ask-${t + 1}`)
    await a.type('draft', turn.q, { interval: 38 })
    await a.wait(350)
    a.put({ sent: t + 1, draft: '' })
    await a.wait(500)
    // Each tool runs, then ticks
    for (let i = 1; i <= turn.tools.length; i++) {
      a.put({ tools: BEFORE[t]! + i - 0.5 })
      await a.wait(550)
      a.put({ tools: BEFORE[t]! + i })
      await a.wait(200)
    }
    await a.wait(250)
    a.mark(`answer-${t + 1}`)
    for (let w = 1; w <= WORDS[t]!; w++) {
      a.put((s) => ({ words: s.words.map((n, i) => (i === t ? w : n)) }))
      await a.wait(40)
    }
    await a.wait(t === TURNS.length - 1 ? 2600 : 1100)
  }
  a.mark('end')
}

function Thread({ s }: { s: S }) {
  return (
    <div className="cl-thread">
      <div className="cl-past" aria-hidden>
        {PAST.map((turn, i) => (
          <div key={i} className="cl-past__turn">
            <Bar w={turn.q} h={34} r={16} tone={1} className="cl-past__q" />
            {turn.lines.map((w, j) => <Bar key={j} w={w} h={9} r={4} tone={2} />)}
          </div>
        ))}
      </div>
      {TURNS.map((turn, t) => (
        <Collapse key={t} open={s.sent > t} reveal="drop" from="below">
          <div className="cl-turn">
            <div className="cl-q">{turn.q}</div>
            <div className="cl-tools">
              {turn.tools.map((name, i) => {
                const n = BEFORE[t]! + i + 1
                return (
                  <Collapse key={name} open={s.tools >= n - 0.5}>
                    <div className="cl-tool" data-done={s.tools >= n || undefined}>
                      <Logo size={18} />
                      <span className="cl-tool__by">Luminous Money</span>
                      <code className="cl-tool__name">{name}</code>
                      <States
                        className="cl-tool__state"
                        value={s.tools >= n ? 'done' : 'busy'}
                        states={{ busy: <span className="cl-dots"><i /><i /><i /></span>, done: <Check size={14} strokeWidth={3} /> }}
                      />
                    </div>
                  </Collapse>
                )
              })}
            </div>
            <Collapse open={s.words[t]! > 0}>
              <Stream className="cl-a" text={turn.a} count={s.words[t]!} mark={(w) => w.startsWith('#')} />
            </Collapse>
          </div>
        </Collapse>
      ))}
    </div>
  )
}

export default function ClaudeScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 520 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      className="lm lm-claude"
    >
      {(s, _rect, layout) => {
        const chat = (
          <div className="cl-chat">
            <Thread s={s} />
            <Field className="cl-composer" value={s.draft} placeholder="Reply to Claude" focused={s.sent < TURNS.length} />
          </div>
        )
        return layout === 'compact' ? (
          <PhoneScreen className="cl-phone" wallpaper={PAPER}>{chat}</PhoneScreen>
        ) : (
          <Window url="claude.ai" urlShape="pill" className="lm-browser cl-win">{chat}</Window>
        )
      }}
    </Stage>
  )
}
