import { describe as group, expect, it } from "vitest";

import { adjust, describe, due, nominalDates, problem, upcoming, type Rule } from "./schedule.js";

const rule = (r: Partial<Rule>): Rule => ({
  every: 1,
  unit: "month",
  days: [],
  start: "2024-01-31",
  until: null,
  weekend: "keep",
  ...r,
});

group("nominal dates", () => {
  it("months fall on the start's day, clamped to short months", () => {
    expect(nominalDates(rule({}), null, "2024-05-31")).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
      "2024-05-31",
    ]);
  });

  it("months can list days, including the last, every N months", () => {
    const twice = rule({ days: [15, -1], start: "2024-01-10", every: 2 });
    expect(nominalDates(twice, null, "2024-04-30")).toEqual([
      "2024-01-15",
      "2024-01-31",
      "2024-03-15",
      "2024-03-31",
    ]);
  });

  it("listed days that clamp to the same date count once", () => {
    expect(nominalDates(rule({ days: [30, 31], start: "2023-02-01" }), null, "2023-02-28")).toEqual(
      ["2023-02-28"]
    );
  });

  it("weeks and days step from the start; years keep the date, clamping Feb 29", () => {
    expect(
      nominalDates(rule({ unit: "week", every: 2, start: "2024-03-01" }), null, "2024-03-31")
    ).toEqual(["2024-03-01", "2024-03-15", "2024-03-29"]);
    expect(
      nominalDates(rule({ unit: "day", every: 10, start: "2024-03-01" }), null, "2024-03-25")
    ).toEqual(["2024-03-01", "2024-03-11", "2024-03-21"]);
    expect(nominalDates(rule({ unit: "year", start: "2024-02-29" }), null, "2026-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
    ]);
  });

  it("respects `after` (exclusive) and the end date", () => {
    const monthly = rule({ start: "2024-01-01", until: "2024-04-01" });
    expect(nominalDates(monthly, "2024-02-01", "2024-12-31")).toEqual(["2024-03-01", "2024-04-01"]);
  });
});

group("weekends and due dates", () => {
  it("weekend days stay, or move to the Friday before or Monday after", () => {
    expect(adjust("2024-06-15", "keep")).toBe("2024-06-15"); // Saturday
    expect(adjust("2024-06-15", "before")).toBe("2024-06-14");
    expect(adjust("2024-06-16", "before")).toBe("2024-06-14"); // Sunday
    expect(adjust("2024-06-15", "after")).toBe("2024-06-17");
    expect(adjust("2024-06-12", "after")).toBe("2024-06-12"); // a Wednesday stays
  });

  it("is due on its adjusted date: a Saturday payday moved to Friday is due on Friday", () => {
    const pay = rule({ days: [15], start: "2024-06-01", weekend: "before" });
    expect(due(pay, null, "2024-06-13")).toEqual([]);
    expect(due(pay, null, "2024-06-14")).toEqual([{ nominal: "2024-06-15", date: "2024-06-14" }]);
  });

  it("stops at the first occurrence not yet due, so none is staged out of order", () => {
    const daily = rule({ unit: "day", start: "2024-06-14", weekend: "after" });
    // Fri 14 is due; Sat 15 lands on Mon 17, not yet: Sun 16 waits behind it.
    expect(due(daily, null, "2024-06-16").map((o) => o.nominal)).toEqual(["2024-06-14"]);
  });

  it("catches up on everything missed", () => {
    expect(
      due(rule({ start: "2024-01-01" }), "2024-01-01", "2024-04-15").map((o) => o.date)
    ).toEqual(["2024-02-01", "2024-03-01", "2024-04-01"]);
  });

  it("lists what's coming", () => {
    expect(upcoming(rule({ start: "2024-01-01" }), "2024-03-02", 2).map((o) => o.date)).toEqual([
      "2024-04-01",
      "2024-05-01",
    ]);
  });
});

it("describes rules in words", () => {
  expect(describe(rule({ start: "2024-01-01", days: [15, 1] }))).toBe(
    "Every month on the 1st and 15th"
  );
  expect(describe(rule({ days: [-1], every: 3 }))).toBe("Every 3 months on the last day");
  expect(describe(rule({ unit: "week", every: 2, start: "2024-03-01", weekend: "before" }))).toBe(
    "Every 2 weeks on Friday, weekends moving to the Friday before"
  );
  expect(describe(rule({ unit: "year", start: "2024-03-05", until: "2030-01-01" }))).toBe(
    "Every year on March 5, until 2030-01-01"
  );
  expect(describe(rule({ unit: "day", start: "2024-03-22" }))).toBe("Every day");
  expect(describe(rule({ days: [22], start: "2024-03-22" }))).toBe("Every month on the 22nd");
});

it("says what's wrong with a rule", () => {
  expect(problem(rule({}))).toBeNull();
  expect(problem(rule({ every: 0 }))).toMatch(/every/);
  expect(problem(rule({ until: "2023-01-01" }))).toMatch(/before the start/);
  expect(problem(rule({ days: [32] }))).toMatch(/1 to 31/);
});
