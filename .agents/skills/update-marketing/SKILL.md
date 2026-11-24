---
name: update-marketing
description: Keep Luminous Money's marketing current, which covers the landing page and demo video on GitHub Pages, their feature scenes and copy, the link previews, the README's pitch and the repository's description. It says where each asset lives, how to find what changed in the product since each was published, how to regenerate and publish them, and the voice and the fixed words to keep. Use it whenever someone asks to update, refresh, re-record or republish the site, the video, the poster, the landing page or "the marketing", to add a feature to the site or the video, to change the headline or the pitch, or to check whether the marketing is stale after a release.
---

# Updating the marketing

Luminous Money's marketing is one landing page with a demo video, plus the same pitch in a
few other places. The page and the video are built from the same scenes, so a feature is
written once and shows up in both. This skill covers what to change, how to rebuild it and
how to publish it. Kael's own words are fixed (see "Words that don't change"). Everything
else follows the voice below.

## Where everything is

| Asset | Source | Published |
|---|---|---|
| **Feature scenes and their copy** | `site/src/scenes/index.ts` (order, `title`, `line`, `points`); `site/src/scenes/<id>.tsx` and `.css` (the animated faux UI) | On the page and in the video |
| **Landing page** | `site/index.html` (`<title>`, `description`, `og:` tags); `site/src/landing.tsx` (hero, the features from `SCENES`, the `MORE` tiles, Get started, footer); `site/src/landing.css` | https://luminous-money.github.io/luminous-money/ (the `gh-pages` branch) |
| **Demo video** | The reel: `site/reel.html`, `site/src/reel.tsx` (a scene beside its copy, plus the `intro` and `outro` title cards); recorded by `site/scripts/record.mjs` | `luminous-money.mp4` on `gh-pages` only (gitignored on main) |
| **Poster** | A frame of the video (`site/public/poster.jpg`) | `poster.jpg` on `gh-pages`. It's the `og:image` for **both** the site and the app (`services/app/index.html`), so it's every link preview |
| **The app's pitch** | `services/app/src/web/pages/Login.tsx` (the login hero); `services/app/index.html` (description, `og:`); `services/app/vite.config.ts` (the manifest's description) | Ships with a release |
| **README** | The opening paragraph and "What it does" in `README.md` | GitHub |
| **Repository description** | `gh repo view luminous-money/luminous-money --json description` | GitHub |

The background is in `site/README.md` (commands), `site/REHEARSAL.md` (what was checked in the
scenes) and design.md's "The site and its demo video" (the decisions, and "The pitch"). The
scenes are built with the Stageshow kit (`site/src/kit/`, copied in). For building or
reworking a scene, load the **stageshow** skill (`~/.agents/skills/stageshow`) and follow its
workflow and gold examples.

## 1. Find what changed since each was published

The page and the video are published separately: a copy change republishes the page with the
old video. Each `gh-pages` commit is titled "The site, from <main's commit>", so:

```sh
site/scripts/since-published.sh          # both baselines, and main's commits since the older one
site/scripts/since-published.sh --stat   # with each commit's files
```

Then read what those commits did, from the newest `RESUME.md` sections back to the baseline's
date (each has what was built and why), and docs/PLAN.md's Done and Ahead lists. For each change,
ask whether a visitor would see it or care about it:

- **A new feature someone would choose the product for** (the MCP server, HSA tracking) gets a
  scene if it can be shown in a few beats, or else a `MORE` tile. It also goes in the README's
  "What it does".
- **A change to something already shown** (the breakdown's month range, shared connections)
  updates that scene's `line` or `points`. If the scene now shows the UI wrongly, rework the
  scene itself.
- **Fixes, tests, internals, security hardening, ops:** leave them out unless they change a
  claim on the page (the install commands, "one command", what the server needs).
- **Check every existing claim** against the product as it is now: a renamed page, a dropped
  option or a new default can make a scene or a point untrue.

Write the list down: each change, what it touches, and the decision. That list goes in the
RESUME entry when you're done.

## 2. Change the copy and the scenes

- **Copy:** `scenes/index.ts` for a feature (each has a `title`, a one- or two-sentence `line`,
  and three `points`); `landing.tsx` for the tiles, Get started and the footer;
  `site/index.html` for the meta `description`. The reel reads the same `SCENES`, so the video's
  copy follows once it's re-recorded.
- **A new scene:** `site/src/scenes/<id>.tsx` and `.css`, added to `SCENES` in the order it
  should be told. `record.mjs` picks up the order from `index.ts`, and the reel's progress
  dots grow by themselves. Follow the existing scenes: `Stage` at 640 × 600 with a
  `compact` design at 358 wide (a redesign, not a squeeze), the `lm` class and the app's look
  (`look.css`), `AppFrame`/`PhoneScreen`/`Masthead` from `parts.tsx`, `play="once"`, a `POSTER`
  state that shows the payoff, `act.mark('end')` when the payoff lands, and about 6 to 13
  seconds. The comment at the top says the story and lists the real strings.
- **Rehearse every scene you touched**, wide and at 390, with the gate, until both end
  `rehearsal passed`. Then look at the contact sheets and end stills yourself, because passing
  is necessary but not sufficient:

  ```sh
  cd site && npm install && npm run dev &      # http://127.0.0.1:5190
  export CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
  node scripts/stageshow/film.mjs "http://127.0.0.1:5190/reel.html?scene=<id>" --select .reel-stage --gate --out shots/<id>-film.png
  node scripts/stageshow/film.mjs "http://127.0.0.1:5190/reel.html?scene=<id>&bare" --width 390 --gate --out shots/<id>-film-390.png
  node scripts/stageshow/film.mjs "http://127.0.0.1:5190/reel.html?scene=<id>" --select .reel-stage --still --at end --out shots/<id>-end.png
  ```

  Add what you checked to `site/REHEARSAL.md` (beats and durations, the film lines judged
  intentional, what wasn't checked). `shots/` and `out/` are gitignored scratch.
- `npx tsc --noEmit` in `site/` before building.

## 3. Regenerate the video and the poster

Re-record whenever a scene or its copy changed, or the intro or outro did. The video shows the
copy too, so a copy-only change leaves it stale.

```sh
cd site
npm run build && (npx vite preview --port 5191 --strictPort &)
node scripts/record.mjs --out public/luminous-money.mp4      # every segment; --only <id>,<id> re-records just those
ffprobe -v error -show_entries format=duration -of csv=p=0 public/luminous-money.mp4
```

`--only` reuses the other segments in `out/segments/`, but only if they're from this machine and
still current. When in doubt, record everything (a few minutes).

- **Watch it:** make a contact sheet and look at every frame for cut-off copy, a scene that ends
  early, or a blank card. For example:
  `ffmpeg -i public/luminous-money.mp4 -vf "fps=1/3,scale=640:-1,tile=4x8" -frames:v 1 shots/video-sheet.png`.
- **The poster** is the frame most people see: link previews (the site and the app), the
  player before it plays. Pick a scene's payoff with its copy beside it, held still (not mid-move
  or mid-crossfade), and say which one in the RESUME. Find a segment's start by adding up the
  durations `record.mjs` prints, minus 0.5 s for each crossfade, then:
  `ffmpeg -y -ss <seconds> -i public/luminous-money.mp4 -frames:v 1 -q:v 3 public/poster.jpg`.

## 4. Check the page, then publish

- **Look at the built page** (`npx vite preview`, port 5191) full-page at 1440 and 390, using
  `node scripts/stageshow/film.mjs http://127.0.0.1:5191/ --still --width 1440 --out shots/landing-1440.png`
  (or Playwright). Check that the new scene plays in its place, that a tile grid doesn't end
  in an orphan row that looks wrong, and that nothing overflows at 390.
- **Publish:** `site/scripts/publish.sh` builds, commits `dist/` to `gh-pages` (as "The site,
  from <main's HEAD>") and pushes, and Pages rebuilds in about a minute. If no new video or
  poster was recorded, it takes the published ones. **Commit the source on main first**, so the
  `gh-pages` commit names a commit that has it. Otherwise `since-published.sh` can't tell what was
  published.
- **Check it live:** `curl -sI https://luminous-money.github.io/luminous-money/luminous-money.mp4`
  (its `content-length` is the new file's), and the page's text.
- **Outside the site,** if the pitch or the features changed: the README; the repository's
  description (`gh repo edit luminous-money/luminous-money --description "…"`, which is
  outward-facing, so confirm the words); and the app's copy (`Login.tsx`, `index.html`,
  `vite.config.ts`), which reaches users only in a release.
- **Close it out** per CLAUDE.md: RESUME.md (what changed and why, the video's length, the
  poster's frame, what was published), and docs/PLAN.md. The site and the video have no tests
  in `pnpm test`, and a site-only change needs no release.

## Words that don't change

Kael wrote these. Use them verbatim everywhere they appear, and change them only when Kael
asks. When he does, change **every** place listed, then record it in design.md's "The pitch".

- **The headline:** "Household accounting for modern life." On the page it breaks after
  "accounting", and the second line ("for modern life.") keeps the white-to-cyan glow
  (`lp-glow`). As a `<title>`: "Luminous Money: household accounting for modern life".
- **The subtext:** "Double-entry accounting to manage your assets, expenses, goals, budgets
  and loans on mobile or desktop. Open source and self-hostable."
- **Where both go:** the site's hero, `<title>` and `og:description`; the reel's intro card
  (headline only); the login page's hero; the app's `index.html` description and `og:` tags;
  the manifest's description (`vite.config.ts`); the README's opening; and the repository's
  description (both sentences, headline first).
- **The loans scene's title:** "Managing loans, made easy".
- **The eyebrow:** "Free and open source · self-hosted". **The footer:** "Early, and in daily
  use. GPL-2.0-or-later." **The outro card:** "Run it yourself, today." over
  `bash luminous-money install` and the repository's address.
- **The install commands** are the release's real ones (`landing.tsx`'s `INSTALL`, the outro,
  the README). They change only when the product's install changes.

## Voice

Plain, concrete and calm, the way the README and RESUME are written: say what it does for
you, with no hype.

- **Titles** are short, often a noun and a twist after a comma: "Your bank, synced",
  "Receipts, itemized", "Amazon, item by item", "Your books, in Claude", "Run it anywhere".
  Sentence case, with no period.
- **Lines** are one or two sentences in the second person, about what happens rather than the
  technology. An optional part comes with its way out: "Or import CSVs and skip it.", "Or leave
  it out: everything else works without it."
- **Points** come three to a scene. They're fragments with no closing period, each one
  concrete: "Swipe right to confirm, left to skip", "HSA and FSA eligible items tagged, the
  invoice attached".
- **Punctuation:** colons and commas, never em dashes. No exclamation marks, and no "seamless",
  "powerful", "effortless", "AI-powered" or anything else a visitor would skip past. No emoji.
- **Name real things by their names:** SimpleFIN Bridge, Anthropic, Claude, Beancount,
  GnuCash, Amazon, Docker. Don't claim what the product doesn't do. If a claim is doubtful,
  read the code or the RESUME.
- **Money and names in scenes are made up.** There must be **no real financial data**
  (CLAUDE.md), so no amounts, payees or accounts from Kael's book, even "for realism". Keep one
  household's story consistent across scenes (the reports scene's October: Food $1,236.15,
  Restaurants $336.15, Kin Soy $53.15 on Oct 28; the Claude scene reuses it).
- **Look:** the scenes are in the app's light look on the product's blue tile, and dark mode is
  deliberately not shown. Use our blue only on what is Luminous Money's. Another product shown
  in a scene (Claude, a terminal) stays neutral, without a made-up logo.
