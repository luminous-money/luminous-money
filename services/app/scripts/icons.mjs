/**
 * The PWA's PNG icons, rendered from public/icon.svg (the Lu logo) with Chromium:
 *
 * - icon-192.png, icon-512.png: the icon as it is, a rounded square
 * - apple-touch-icon.png (180): full bleed, since iOS rounds the corners itself
 * - maskable-512.png: full bleed, "Lu" centered and kept inside the safe zone (the middle 80%),
 *   so a launcher's mask never cuts into it
 *
 * Run from the repo with `pnpm icons` (scripts/icons.sh), after changing icon.svg.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const dir = process.argv[2] ?? "services/app/public";
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const lu = /<g class="filled">[\s\S]*?<path fill="#fff" d="([^"]+)"/.exec(svg)?.[1];
if (!lu) throw new Error("icon.svg has no filled Lu path");
const VIEW = { x: 0.023386, y: 0.025193, size: 16.933334 };

const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: "light" });

/** A full-bleed square of the gradient with "Lu" centered, at `scale` of its size in icon.svg. */
async function fullBleed(scale) {
  await page.setContent(`<svg id="m" xmlns="http://www.w3.org/2000/svg"><path id="lu" d="${lu}"/></svg>`);
  const box = await page.evaluate(() => {
    const b = document.getElementById("lu").getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = VIEW.x + VIEW.size / 2;
  const cy = VIEW.y + VIEW.size / 2;
  const s = typeof scale === "function" ? scale(box) : scale;
  const tx = cx - s * (box.x + box.width / 2);
  const ty = cy - s * (box.y + box.height / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}">
    <defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${VIEW.x}" y1="${VIEW.y}" x2="${VIEW.x + VIEW.size}" y2="${VIEW.y + VIEW.size}">
      <stop offset="0" stop-color="#0062a8"/><stop offset="1" stop-color="#003052"/></linearGradient></defs>
    <rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.size}" height="${VIEW.size}" fill="url(#g)"/>
    <path fill="#fff" transform="translate(${tx} ${ty}) scale(${s})" d="${lu}"/></svg>`;
}

async function render(source, size, file) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  await page.setContent(
    `<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`
  );
  await page.waitForFunction(() => document.images[0]?.complete);
  writeFileSync(join(dir, file), await page.screenshot({ omitBackground: true }));
  console.log(`wrote ${file}`);
}

await render(svg, 192, "icon-192.png");
await render(svg, 512, "icon-512.png");
await render(await fullBleed(1), 180, "apple-touch-icon.png");
// The safe zone is a circle of 40% of the size around the middle: keep the glyphs' corners in it.
await render(
  await fullBleed((b) => Math.min(1, (0.4 * 0.92 * VIEW.size) / Math.hypot(b.width / 2, b.height / 2))),
  512,
  "maskable-512.png"
);
await browser.close();
