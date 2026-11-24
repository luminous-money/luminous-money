Luminous Money: the site
==================================================================================================

The landing page and the demo video, published to GitHub Pages from the `gh-pages` branch
(https://luminous-money.github.io/luminous-money/). A standalone project: npm, not part of the
pnpm workspace, and left out of the Docker builds.

- **The scenes** (`src/scenes/`, one per feature) are faux product UI built with the
  Stageshow kit (`src/kit/`, MIT, copied in) in the app's own look
  (`src/look.css`: its palette, Geist, its radii). Each has a wide design (640 × 600) and a
  compact one for a phone's column (358 wide), and plays once. `src/scenes/index.ts` is their
  order and copy, shared by the video and the page. No real financial data: every name and figure
  in them is made up.
- **The landing page** is `index.html` / `src/landing.tsx`.
- **The video** is recorded from the reel (`reel.html` / `src/reel.tsx`: 1280 × 720, a scene beside
  its copy, `?scene=<id>`; `intro` and `outro` are the title cards). `scripts/record.mjs` puts the
  page on the kit's virtual clock, steps it one frame at a time at 1920 × 1080, pipes the frames to
  ffmpeg and joins the segments with crossfades.

```sh
npm install
npm run dev                                   # http://127.0.0.1:5190/ (the reel: /reel.html?scene=review)
npm run build && npx vite preview &           # http://127.0.0.1:5191/
node scripts/record.mjs --out public/luminous-money.mp4   # needs ffmpeg and a Chromium (CHROME_PATH)
./scripts/publish.sh                          # build, commit dist/ to gh-pages, push
```

Re-record after changing a scene, then take a new poster from it:
`ffmpeg -ss 24 -i public/luminous-money.mp4 -frames:v 1 -q:v 3 public/poster.jpg`. The video and
poster aren't kept on main; `publish.sh` takes the published ones when they're not here.

**Checking a scene** (the kit's rehearsal, `scripts/stageshow/`): film it wide and at a phone's
width with the gate, which ends `rehearsal passed` when nothing a viewer would see is wrong:

```sh
export CHROME_PATH=~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell
node scripts/stageshow/film.mjs "http://127.0.0.1:5190/reel.html?scene=review" --select .reel-stage --gate
node scripts/stageshow/film.mjs "http://127.0.0.1:5190/reel.html?scene=review&bare" --width 390 --gate
```

`REHEARSAL.md` says what was checked and what wasn't.

**Keeping it current:** the `update-marketing` skill (`.agents/skills/update-marketing/SKILL.md`)
has the whole routine: where every asset is, what changed since each was published
(`./scripts/since-published.sh`), regenerating and publishing, the voice, and the words that
don't change.
