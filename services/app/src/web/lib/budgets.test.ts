import { describe, expect, it } from "vitest";

import { daysLeft, defaultStart, per, standing, thisPeriod } from "./budgets.js";

describe("a new budget's default start", () => {
  const thursday = "2026-10-15";

  it("is the first day of the calendar period today is in", () => {
    expect(defaultStart({ every: 1, unit: "month" }, thursday, 1)).toBe("2026-10-01");
    expect(defaultStart({ every: 3, unit: "month" }, thursday, 1)).toBe("2026-10-01");
    expect(defaultStart({ every: 3, unit: "month" }, "2026-08-20", 1)).toBe("2026-07-01");
    expect(defaultStart({ every: 1, unit: "year" }, thursday, 1)).toBe("2026-01-01");
    expect(defaultStart({ every: 1, unit: "day" }, thursday, 1)).toBe(thursday);
  });

  it("starts weeks on the book's day", () => {
    expect(defaultStart({ every: 1, unit: "week" }, thursday, 1)).toBe("2026-10-12"); // Monday
    expect(defaultStart({ every: 2, unit: "week" }, thursday, 0)).toBe("2026-10-11"); // Sunday
    expect(defaultStart({ every: 1, unit: "week" }, thursday, 4)).toBe(thursday); // Thursday
  });
});

it("says periods in words", () => {
  expect(per({ every: 1, unit: "month" })).toBe("a month");
  expect(per({ every: 3, unit: "month" })).toBe("a quarter");
  expect(per({ every: 2, unit: "week" })).toBe("every 2 weeks");
  expect(thisPeriod({ every: 1, unit: "week" })).toBe("this week");
  expect(thisPeriod({ every: 2, unit: "week" })).toBe("this period");
  expect(daysLeft({ period_end: "2026-11-01" }, "2026-10-15")).toBe(17);
});

it("tells limits from goals", () => {
  expect(standing("limit", "400", "312").standing).toBe("under");
  expect(standing("limit", "400", "380").standing).toBe("near");
  expect(standing("limit", "400", "401").standing).toBe("over");
  expect(standing("goal", "5000", "5000").standing).toBe("reached");
  expect(standing("limit", "400", "-20").share).toBe(0); // refunds beyond what was spent
});
