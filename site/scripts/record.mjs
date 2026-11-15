// Record the demo video from the reel (reel.html), one segment at a time, then join them.
//
//   node scripts/record.mjs [--url http://127.0.0.1:5191] [--out public/luminous-money.mp4]
//                           [--only review,funds] [--fps 30]
//
// Each segment is reel.html?scene=<id>&record: the page runs on the kit's virtual clock, and this
// script steps it one frame at a time, screenshots the frame at 1920 × 1080 and pipes it to
// ffmpeg, so every frame lands exactly and nothing drops. A scene ends a short hold after its
// script marks 'end'; the title cards run for a fixed time. The segments are then joined with
// short crossfades. Needs ffmpeg and a Chromium (CHROME_PATH, or Playwright's headless shell).

import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const base = opt('url', 'http://127.0.0.1:5191')
const out = resolve(opt('out', join(here, '..', 'public', 'luminous-money.mp4')))
const fps = Number(opt('fps', '30'))
const work = join(here, '..', 'out', 'segments')
mkdirSync(work, { recursive: true })
mkdirSync(dirname(out), { recursive: true })

// The scenes, in the reel's order (src/scenes/index.ts), between the two title cards
const sceneIds = [...readFileSync(join(here, '..', 'src', 'scenes', 'index.ts'), 'utf8').matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1])
const only = opt('only', '').split(',').filter(Boolean)
const segments = [
  { id: 'intro', seconds: 3.6 },
  ...sceneIds.map((id) => ({ id, hold: 0.6, max: 20 })),
  { id: 'outro', seconds: 5 },
]
const FADE = 0.5

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), '.cache', 'ms-playwright')
  for (const dir of existsSync(root) ? spawnSync('ls', [root]).stdout.toString().split('\n') : []) {
    const shell = join(root, dir, 'chrome-linux', 'headless_shell')
    if (dir.startsWith('chromium_headless_shell') && existsSync(shell)) return shell
  }
  throw new Error('No Chromium found: set CHROME_PATH')
}

const browser = await chromium.launch({ executablePath: chromePath() })

async function record({ id, seconds, hold, max }) {
  const file = join(work, `${id}.mp4`)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })
  page.on('pageerror', (e) => console.error(`[${id}] ${e.message}`))
  await page.goto(`${base}/reel.html?scene=${id}&record`)
  await page.waitForFunction(() => !!window.__stageshow?.clock && document.fonts.status === 'loaded')
  await page.waitForSelector('.reel')
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] })
  const step = () => page.evaluate(() => window.__stageshow.clock.step(1))
  const mark = () => page.evaluate(() => document.querySelector('.ss-stage')?.getAttribute('data-mark') ?? null)
  let frames = 0
  let endAt = seconds ? Math.round(seconds * fps) : Infinity
  const limit = Math.round((max ?? seconds) * fps)
  while (frames < endAt && frames < limit) {
    await step()
    const png = await page.screenshot({ type: 'png' })
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r))
    frames++
    if (endAt === Infinity && (await mark()) === 'end') endAt = frames + Math.round(hold * fps)
  }
  if (endAt === Infinity) console.warn(`[${id}] never marked 'end'; cut at ${max}s`)
  ffmpeg.stdin.end()
  await new Promise((r) => ffmpeg.on('close', r))
  await page.close()
  console.log(`${id}: ${(frames / fps).toFixed(1)}s`)
  return { file, duration: frames / fps }
}

const done = []
for (const seg of segments) {
  if (only.length && !only.includes(seg.id)) {
    const file = join(work, `${seg.id}.mp4`)
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    done.push({ file, duration: Number(probe.stdout.toString()) })
    continue
  }
  done.push(await record(seg))
}
await browser.close()

// Join: each segment crossfades into the next
const inputs = done.flatMap((d) => ['-i', d.file])
let filter = ''
let last = '[0:v]'
let offset = 0
for (let i = 1; i < done.length; i++) {
  offset += done[i - 1].duration - FADE
  const label = i === done.length - 1 ? '[v]' : `[x${i}]`
  filter += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`
  last = label
}
const join_ = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter.replace(/;$/, ''), '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' })
if (join_.status !== 0) process.exit(join_.status ?? 1)
const total = done.reduce((t, d) => t + d.duration, 0) - FADE * (done.length - 1)
console.log(`${out}: ${total.toFixed(1)}s`)
