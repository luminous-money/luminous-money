import { Bar, Button, Caret, Field, Prompt, Stage, Window, type Act } from '../kit'
import { Logo } from '../parts'
import type { SceneProps } from './types'
import './install.css'

// Run it anywhere: the installer in a terminal. It asks where people will reach it; a public
// server with a domain is chosen, the domain typed, and it says it's running. The new instance's
// sign-up page comes forward over the terminal's corner.
//
// Real strings: the installer's own prompts and its last line (scripts/luminous-money), and the
// sign-up page's title, fields and button.

type S = { cmd: string; asked: boolean; choice: string; domain: string; askedDomain: boolean; installing: boolean; done: boolean; site: boolean }

const CMD = 'bash luminous-money install'
const DOMAIN = 'books.example.com'
const initial: S = { cmd: '', asked: false, choice: '', domain: '', askedDomain: false, installing: false, done: false, site: false }
const POSTER: S = { cmd: CMD, asked: true, choice: '2', domain: DOMAIN, askedDomain: true, installing: true, done: true, site: true }

async function script(a: Act<S>) {
  await a.wait(800)
  a.mark('install')
  await a.type('cmd', CMD, { interval: 38 })
  await a.wait(200)
  await a.key('enter')
  a.put({ asked: true })
  await a.wait(900)
  await a.type('choice', '2', { interval: 60 })
  await a.key('enter')
  a.put({ askedDomain: true })
  await a.wait(500)
  await a.type('domain', DOMAIN, { interval: 40 })
  await a.key('enter')
  a.put({ installing: true })
  await a.wait(1300)
  a.mark('done')
  a.put({ done: true })
  await a.wait(700)
  a.put({ site: true })
  await a.wait(3000)
  a.mark('end')
}

export default function InstallScene({ play = 'once' }: SceneProps) {
  return (
    <Stage<S>
      width={640}
      height={600}
      compact={{ below: 600, width: 358, height: 330 }}
      initial={initial}
      poster={POSTER}
      script={script}
      play={play}
      keys={{ wide: 'top', compact: 'top' }}
      className="lm lm-install"
    >
      {(s, _rect, layout) => (
        <>
          <Window chrome="terminal" title="kael@server — zsh" className="in-term">
            <Prompt path="~">docker --version</Prompt>
            <div className="dim">Docker version 27.3.1</div>
            <Prompt path="~">curl -fsSLO {layout === 'wide' ? '…/releases/latest/download/luminous-money' : '…/luminous-money'}</Prompt>
            <Prompt path="~">
              {s.cmd}
              {!s.asked && <Caret still={s.cmd.length > 0 && s.cmd.length < CMD.length} />}
            </Prompt>
            {s.asked && (
              <>
                <div data-snap>Where will people reach it?</div>
                <div className="dim" data-snap>  1) This computer, or my own network</div>
                <div data-snap>  2) A public server{layout === 'wide' ? ' with a domain name' : ''} (HTTPS)</div>
                <div data-snap>
                  Choose [1]: {s.choice}
                  {!s.askedDomain && <Caret />}
                </div>
              </>
            )}
            {s.askedDomain && (
              <div data-snap>
                The domain{layout === 'wide' ? ', e.g. books.example.com' : ''}: {s.domain}
                {!s.installing && <Caret />}
              </div>
            )}
            {s.installing && layout === 'wide' && <div className="dim" data-snap>Installing Luminous Money 0.1.31…</div>}
            {s.done && (
              <>
                <div className="ok" data-snap>{layout === 'wide' ? 'Luminous Money is running' : 'Running'}: https://{DOMAIN}/</div>
                {layout === 'wide' && <div data-snap>Create your account there: the first one is no different from the rest.</div>}
                {layout === 'wide' && <div className="dim" data-snap>From now on: ./luminous-money status | backup | upgrade | logs</div>}
              </>
            )}
          </Window>

          {layout === 'wide' && <Window url={DOMAIN} urlShape="pill" className="lm-browser in-site" data-open={s.site || undefined}>
            <div className="lm-page in-page">
              <Logo size={40} />
              <div className="in-title">Create your account</div>
              <Field label="Email" value="" placeholder="you@example.com" />
              <div className="in-gap" />
              <Field label="Password" value="" placeholder="" />
              <Button className="lm-btn in-go" variant="primary">Create account</Button>
              <Bar className="in-fine" w={150} h={7} r={3.5} tone={2} />
            </div>
          </Window>}
        </>
      )}
    </Stage>
  )
}
