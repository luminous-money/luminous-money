import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, BookOpen, Check, Copy, Github, RotateCcw } from 'lucide-react'
import '@fontsource-variable/geist'
import './look.css'
import './landing.css'
import { Logo } from './parts'
import { SCENES } from './scenes'
import type { Scene } from './scenes/types'

// The landing page: the video, each feature beside its scene, the rest of what it does, and how
// to run it yourself. The scenes are the reel's own (src/scenes), playing once as they come into
// view, each with a Replay.

const REPO = 'https://github.com/luminous-money/luminous-money'
const INSTALL = `curl -fsSL ${REPO}/releases/latest/download/luminous-money -o luminous-money
bash luminous-money install`

// Geist before the first render: the scenes measure their labels as they mount
await Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 15px "Geist Variable"`)))

function Landing() {
  return (
    <>
      <header className="lp-top">
        <a className="lp-brand" href="#top"><Logo size={32} />Luminous Money</a>
        <nav className="lp-nav">
          <a href="#features">Features</a>
          <a href="#start">Get started</a>
          <a className="lp-nav__gh" href={REPO}><Github size={18} strokeWidth={2} />GitHub</a>
        </nav>
      </header>

      <main id="top">
        <section className="lp-hero">
          <div className="lp-eyebrow">Free and open source · self-hosted</div>
          <h1 className="lp-title">
            Household accounting
            <br />
            <span className="lp-glow">for modern life.</span>
          </h1>
          <p className="lp-lede">
            Double-entry accounting to manage your assets, expenses, goals, budgets and loans on mobile
            or desktop. Open source and self-hostable.
          </p>
          <div className="lp-ctas">
            <a className="lp-btn lp-btn--primary" href="#start">Get started<ArrowRight size={18} strokeWidth={2.25} /></a>
            <a className="lp-btn" href={REPO}><Github size={18} strokeWidth={2} />View on GitHub</a>
          </div>
          <div className="lp-video">
            <video src="luminous-money.mp4" poster="poster.jpg" controls muted autoPlay loop playsInline preload="metadata" />
          </div>
        </section>

        <section id="features" className="lp-features">
          {SCENES.map((scene, i) => <Feature key={scene.id} scene={scene} flip={i % 2 === 1} />)}
        </section>

        <section className="lp-more">
          <h2 className="lp-h2">And the rest of a real accounting system</h2>
          <div className="lp-grid">
            {MORE.map(([title, text]) => (
              <div key={title} className="lp-tile">
                <div className="lp-tile__title">{title}</div>
                <div className="lp-tile__text">{text}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="start" className="lp-start">
          <h2 className="lp-h2">Get started</h2>
          <p className="lp-start__lede">
            On a laptop, a home server or a public server. All it needs is Docker.
          </p>
          <ol className="lp-steps">
            <li>
              <div className="lp-step__title">Download the command and install</div>
              <div className="lp-step__text">
                It asks a couple of questions (this machine, or a public server with a domain and free HTTPS), starts
                everything, and says where to open it.
              </div>
              <CodeBlock code={INSTALL} />
            </li>
            <li>
              <div className="lp-step__title">Create your account</div>
              <div className="lp-step__text">
                Open the address it gives you and sign up. Make a book, then bring your history in: a CSV, a Beancount
                file, or GnuCash's exports.
              </div>
            </li>
            <li>
              <div className="lp-step__title">Connect what you like</div>
              <div className="lp-step__text">
                A SimpleFIN Bridge token for bank feeds, an Anthropic API key for the AI, your Amazon account for
                itemized orders. Each is optional, stored sealed, and yours to share with the books you choose. For
                Claude, <a href={`${REPO}/blob/main/docs/deploying.md#connecting-claude-the-mcp-server`}>add your server as a connector</a>.
              </div>
            </li>
            <li>
              <div className="lp-step__title">Keep it running</div>
              <div className="lp-step__text">The same command looks after it:</div>
              <CodeBlock code={`./luminous-money status\n./luminous-money backup\n./luminous-money upgrade   # backs up first`} />
            </li>
          </ol>
          <div className="lp-ctas lp-ctas--start">
            <a className="lp-btn lp-btn--primary" href={`${REPO}/blob/main/docs/deploying.md`}><BookOpen size={18} strokeWidth={2} />The deployment guide</a>
            <a className="lp-btn" href={`${REPO}/releases`}>Releases<ArrowRight size={18} strokeWidth={2.25} /></a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="lp-brand lp-brand--small"><Logo size={22} />Luminous Money</span>
        <span>Early, and in daily use. GPL-2.0-or-later.</span>
        <a href={REPO}>github.com/luminous-money/luminous-money</a>
      </footer>
    </>
  )
}

function Feature({ scene, flip }: { scene: Scene; flip: boolean }) {
  const [run, setRun] = useState(0)
  const { Component } = scene
  return (
    <article className="lp-feature" data-flip={flip || undefined}>
      <div className="lp-feature__copy">
        <h3 className="lp-feature__title">{scene.title}</h3>
        <p className="lp-feature__line">{scene.line}</p>
        <ul className="lp-points">
          {scene.points.map((p) => (
            <li key={p}><Check size={16} strokeWidth={2.5} />{p}</li>
          ))}
        </ul>
      </div>
      <div className="lp-feature__stage">
        <Component key={run} play="once" />
        <button className="lp-replay" onClick={() => setRun((n) => n + 1)}><RotateCcw size={14} strokeWidth={2.25} />Replay</button>
      </div>
    </article>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="lp-code">
      <pre>{code}</pre>
      <button
        className="lp-code__copy"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(code.replace(/\s+#.*$/gm, ''))
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} strokeWidth={2} />}
      </button>
    </div>
  )
}

const MORE: [string, string][] = [
  ['Real double-entry', 'Beancount is the engine. Every book exports to a Beancount file, and a new book can start from one.'],
  ['Many books, shared', 'Any number of books per server, each shareable to view, edit or manage. One bank connection serves the household book and a personal one.'],
  ['Rules and history', 'Your rules, then what each payee went to before, then the AI: categorized split by split.'],
  ['Investments', 'Holdings with lots, cost basis and gains, prices every morning, and revalued assets like a house.'],
  ['Scheduled transactions', 'Recurring bills staged as they come due, and matched when the bank sees them.'],
  ['Reconciliation', "Agree an account with its statement; bank-fed accounts reconcile themselves."],
  ['Tags, and HSA spending', "Tag a receipt's one item, and reports count only what's tagged. HSA and FSA purchases tag themselves, and say when they need a receipt."],
  ['Migrate in', "From GnuCash with its history, or a chart of accounts from a CSV, with rules learned on the way."],
]

createRoot(document.getElementById('root')!).render(<Landing />)
