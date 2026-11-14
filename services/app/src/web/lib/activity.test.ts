import { expect, it } from "vitest";

import { canReload, QUIET_FOR, type Activity } from "./activity.js";

const idle: Activity = { typed: false, engaged: false, saving: 0, lastInput: 0, hidden: false };
const now = QUIET_FOR + 1;

it("a new version comes in by itself only when nobody's working on anything", () => {
  expect(canReload(idle, now)).toBe(true);
  // Work a reload would lose: never, whatever else.
  for (const busy of [{ typed: true }, { engaged: true }, { saving: 1 }])
    for (const navigating of [false, true])
      expect(canReload({ ...idle, ...busy, hidden: true }, now, navigating)).toBe(false);
});

it("waits for a quiet moment: out of view, a page changed, or a while without a tap", () => {
  const active = { ...idle, lastInput: now - 1000 };
  expect(canReload(active, now)).toBe(false);
  expect(canReload({ ...active, hidden: true }, now)).toBe(true);
  expect(canReload(active, now, true)).toBe(true);
  expect(canReload(active, now + QUIET_FOR)).toBe(true);
});
