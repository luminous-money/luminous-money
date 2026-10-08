import { describe, expect, it } from "vitest";

import { armed, BLOCKED_MAX, offset, outcome, resolveAxis } from "./swipe.js";

const WIDTH = 360; // threshold: min(126, 140) = 126

describe("axis", () => {
  it("waits for enough movement, then follows the dominant direction", () => {
    expect(resolveAxis(3, 4)).toBeNull();
    expect(resolveAxis(12, 4)).toBe("x");
    expect(resolveAxis(-4, 12)).toBe("y");
  });
});

describe("how far the card follows", () => {
  it("follows the finger both ways when it can be confirmed", () => {
    expect(offset(100, true)).toBe(100);
    expect(offset(-100, true)).toBe(-100);
  });

  it("resists and stops short on a right drag when it can't be confirmed", () => {
    expect(offset(40, false)).toBe(10);
    expect(offset(400, false)).toBe(BLOCKED_MAX);
    expect(offset(-100, false)).toBe(-100);
  });
});

describe("releasing", () => {
  it("confirms or skips past the threshold", () => {
    expect(outcome(130, 0, WIDTH, true)).toBe("confirm");
    expect(outcome(-130, 0, WIDTH, true)).toBe("skip");
  });

  it("springs back short of the threshold", () => {
    expect(outcome(100, 0.1, WIDTH, true)).toBe("cancel");
    expect(outcome(-100, -0.1, WIDTH, true)).toBe("cancel");
  });

  it("commits a fast flick even when it's short, but not a twitch", () => {
    expect(outcome(60, 1.2, WIDTH, true)).toBe("confirm");
    expect(outcome(-60, -1.2, WIDTH, true)).toBe("skip");
    expect(outcome(20, 2, WIDTH, true)).toBe("cancel");
    expect(outcome(60, -1.2, WIDTH, true)).toBe("cancel"); // flicked back the other way
  });

  it("never confirms what can't be confirmed, but still skips it", () => {
    expect(outcome(300, 2, WIDTH, false)).toBe("cancel");
    expect(outcome(-300, 0, WIDTH, false)).toBe("skip");
  });

  it("is armed only where releasing would commit", () => {
    expect(armed(130, WIDTH, true)).toBe(true);
    expect(armed(130, WIDTH, false)).toBe(false);
    expect(armed(-130, WIDTH, false)).toBe(true);
    expect(armed(50, WIDTH, true)).toBe(false);
  });
});
