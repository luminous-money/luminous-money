import { createRoot } from 'react-dom/client'
import './look.css'
import './reel.css'
import { Logo } from './parts'
import { SCENES } from './scenes'

// The reel: one frame of the demo video, 1280 × 720. ?scene=<id> shows that feature beside its
// copy; ?scene=intro and ?scene=outro are the title cards. scripts/record.mjs films each in turn.

const params = new URLSearchParams(location.search)
const id = params.get('scene') ?? SCENES[0]!.id

function Frame() {
  // ?bare: the scene alone at the page's width, to film its compact design
  if (params.has('bare')) {
    const { Component } = SCENES.find((s) => s.id === id)!
    return <div className="reel-bare"><Component play="once" /></div>
  }
  if (id === 'intro') return <Intro />
  if (id === 'outro') return <Outro />
  const index = SCENES.findIndex((s) => s.id === id)
  const scene = SCENES[index]!
  const { Component } = scene
  return (
    <div className="reel">
      <div className="reel-copy">
        <div className="reel-brand"><Logo size={26} />Luminous Money</div>
        <div className="reel-title">{scene.title}</div>
        <div className="reel-line">{scene.line}</div>
        <div className="reel-steps" aria-hidden>
          {SCENES.map((s, i) => <span key={s.id} data-on={i === index || undefined} data-done={i < index || undefined} />)}
        </div>
      </div>
      <div className="reel-stage">
        <Component play="once" />
      </div>
    </div>
  )
}

function Intro() {
  return (
    <div className="reel reel-card">
      <div className="reel-card__inner" data-mark="end">
        <Logo size={96} className="reel-card__logo" />
        <div className="reel-card__name">Luminous Money</div>
        <div className="reel-card__line">Household accounting for modern life.</div>
      </div>
    </div>
  )
}

function Outro() {
  return (
    <div className="reel reel-card">
      <div className="reel-card__inner" data-mark="end">
        <Logo size={72} className="reel-card__logo" />
        <div className="reel-card__name">Run it yourself, today.</div>
        <code className="reel-card__code">bash luminous-money install</code>
        <div className="reel-card__line">github.com/luminous-money/luminous-money</div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Frame />)
