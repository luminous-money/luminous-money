import { expect, test, type Locator, type Page } from "@playwright/test";

import { seedBook, stored, type Seeded } from "./support.js";

let seeded: Seeded;

test.beforeEach(async ({ page }) => {
  seeded = await seedBook(page);
  await page.goto(`/ui/books/${seeded.book}/review`);
  await expect(queue(page)).toHaveCount(3);
});

const queue = (page: Page) => page.getByRole("article");
const item = (page: Page, payee: string) =>
  page.getByRole("article", { name: new RegExp(`^${payee}`) });

/**
 * Drag horizontally by `fraction` of the card's width. By default the drag starts on the card's
 * date line (no controls there); `from` starts it on a particular element instead. Slow drags
 * pause between steps so they don't count as flicks.
 */
async function swipe(
  page: Page,
  card: Locator,
  fraction: number,
  { from, slow }: { from?: Locator; slow?: boolean } = {}
) {
  const box = (await card.boundingBox())!;
  const start = from
    ? (await from.boundingBox())!
    : { x: box.x + box.width / 2 - 1, y: box.y + 10, width: 2, height: 20 };
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  const distance = box.width * fraction;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x + (distance * i) / 10, y);
    if (slow) await page.waitForTimeout(40);
  }
  await page.mouse.up();
}

test("swiping right confirms an item that's ready", async ({ page }) => {
  await swipe(page, item(page, "Grocer"), 0.6);

  await expect(queue(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("*");
});

test("swiping left skips an item without changing it", async ({ page }) => {
  await swipe(page, item(page, "Corner Cafe"), -0.6);

  await expect(queue(page).last()).toContainText("Corner Cafe");
  await expect(queue(page)).toHaveCount(3);
  expect((await stored(seeded.book, seeded.ids["Corner Cafe"]!)).flag).toBe("!");
});

test("swiping right on an item that isn't ready springs back", async ({ page }) => {
  const coffee = item(page, "Corner Cafe");
  const before = (await coffee.boundingBox())!.x;

  await swipe(page, coffee, 0.8);

  await expect(queue(page)).toHaveCount(3);
  await expect(queue(page).first()).toContainText("Corner Cafe");
  await expect.poll(async () => (await coffee.boundingBox())!.x).toBe(before);
  await expect(coffee.locator(".category")).toHaveClass(/nudge/); // points at what's missing
  expect((await stored(seeded.book, seeded.ids["Corner Cafe"]!)).flag).toBe("!");
});

test("a short, slow swipe springs back", async ({ page }) => {
  const grocer = item(page, "Grocer");
  const before = (await grocer.boundingBox())!.x;

  await swipe(page, grocer, 0.15, { slow: true });

  await expect.poll(async () => (await grocer.boundingBox())!.x).toBe(before);
  await expect(queue(page)).toHaveCount(3);
  expect((await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("!");
});

test("a swipe that starts on a button doesn't press it", async ({ page }) => {
  const grocer = item(page, "Grocer");

  await swipe(page, grocer, 0.6, { from: grocer.getByRole("link", { name: "Split…" }) });

  await expect(page).toHaveURL(new RegExp(`/ui/books/${seeded.book}/review$`));
  await expect(queue(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("*");
});

test("real touch swipes work, and a vertical drag still scrolls instead", async ({ page }) => {
  // Mouse drags don't exercise touch handling (touch-action, scroll arbitration); real touches do.
  const cdp = await page.context().newCDPSession(page);
  const touch = async (points: { x: number; y: number }[]) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [points[0]!] });
    for (const point of points.slice(1)) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const grocer = item(page, "Grocer");
  const box = (await grocer.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 10;

  await touch(Array.from({ length: 11 }, (_, i) => ({ x, y: y - i * 6 })));
  await expect(queue(page)).toHaveCount(3);

  await touch(Array.from({ length: 11 }, (_, i) => ({ x: x + (box.width * 0.6 * i) / 10, y })));
  await expect(queue(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("*");
});

test("swipes can start on the description field, where a thumb lands", async ({ page }) => {
  const description = (payee: string) =>
    item(page, payee).getByRole("textbox", { name: "Description" });

  await swipe(page, item(page, "Corner Cafe"), -0.6, { from: description("Corner Cafe") });
  await expect(queue(page).last()).toContainText("Corner Cafe");

  await swipe(page, item(page, "Grocer"), 0.6, { from: description("Grocer") });
  await expect(queue(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("*");
  expect((await stored(seeded.book, seeded.ids["Grocer"]!)).narration).toBe("Weekly shop");
});

test("a description edited just before swiping is kept, and the item stays confirmed", async ({
  page,
}) => {
  const grocer = item(page, "Grocer");
  const description = grocer.getByRole("textbox", { name: "Description" });
  await description.fill("Weekly shop and snacks");

  // Still focused: the swipe races the field's save-on-blur.
  await swipe(page, grocer, 0.6, { from: description });

  await expect(queue(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("*");
  await page.waitForTimeout(500);
  const after = await stored(seeded.book, seeded.ids["Grocer"]!);
  expect(after.flag).toBe("*");
  expect(after.narration).toBe("Weekly shop and snacks");
});

test("a touch swipe on the description field doesn't focus it", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const coffee = item(page, "Corner Cafe");
  const description = coffee.getByRole("textbox", { name: "Description" });
  const box = (await description.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - 25 * i, y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect(queue(page).last()).toContainText("Corner Cafe");
  await expect(description).not.toBeFocused();
});

test("the cards below slide up after a confirm or a skip, by button too", async ({ page }) => {
  const top = async (payee: string) => (await item(page, payee).boundingBox())!.y;
  const first = await top("Corner Cafe");
  const second = await top("Grocer");

  await item(page, "Corner Cafe").getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => top("Grocer")).toBe(first);
  await expect(queue(page).last()).toContainText("Corner Cafe");

  await item(page, "Grocer").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => top("Costco")).toBe(first);
  await expect(queue(page)).toHaveCount(2);
  expect(second).toBeGreaterThan(first);
});
