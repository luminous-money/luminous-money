import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nextRun, startDaily, TICK, type DailyJob } from "./daily.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A job at `at` (minutes past midnight, UTC) that counts its runs. */
function counting(at: number): DailyJob & { runs: number } {
  const job = {
    name: "counting",
    at,
    runs: 0,
    zones: () => ["UTC"],
    run: async () => {
      job.runs++;
    },
  };
  return job;
}

/** Let the timer's callbacks (and the runs they start) finish. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("the daily timer", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("TZ", "UTC");
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("runs each job at startup, then just after its time, once", async () => {
    vi.setSystemTime(new Date("2024-03-10T05:00:00Z"));
    const job = counting(6 * 60);
    stop = startDaily([job]);
    await settle();
    expect(job.runs).toBe(1);

    await vi.advanceTimersByTimeAsync(HOUR); // 06:00: not yet a minute past
    expect(job.runs).toBe(1);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(job.runs).toBe(2);
    await vi.advanceTimersByTimeAsync(20 * HOUR);
    expect(job.runs).toBe(2); // not again until tomorrow's
  });

  it("runs a job whose time came while the machine slept soon after it wakes", async () => {
    vi.setSystemTime(new Date("2024-03-10T17:00:00Z"));
    const job = counting(9 * 60);
    stop = startDaily([job]);
    await settle();
    expect(job.runs).toBe(1);

    // Asleep overnight: the clock on the wall moves 16 hours, the timer's not at all.
    vi.setSystemTime(new Date("2024-03-11T09:00:00Z"));
    await vi.advanceTimersByTimeAsync(TICK);
    expect(job.runs).toBe(2);
  });

  it("runs only the jobs that are due", async () => {
    vi.setSystemTime(new Date("2024-03-10T05:00:00Z"));
    const early = counting(6 * 60);
    const late = counting(9 * 60);
    stop = startDaily([early, late]);
    await settle();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect([early.runs, late.runs]).toEqual([2, 1]);
  });

  it("counts a time added since the job last ran", async () => {
    vi.setSystemTime(new Date("2024-03-10T05:00:00Z"));
    const times: { at: number; zone: string }[] = [];
    const job = Object.assign(counting(9 * 60), { times: () => times });
    stop = startDaily([job]);
    await settle();
    times.push({ at: 6 * 60, zone: "UTC" }); // a bank connection linked, at 06:00
    await vi.advanceTimersByTimeAsync(HOUR + TICK);
    expect(job.runs).toBe(2);
  });

  it("waits for the services before the first run", async () => {
    vi.setSystemTime(new Date("2024-03-10T05:00:00Z"));
    const job = counting(6 * 60);
    let up!: () => void;
    stop = startDaily([job], new Promise((resolve) => (up = resolve)));
    await vi.advanceTimersByTimeAsync(TICK);
    expect(job.runs).toBe(0);
    up();
    await settle();
    expect(job.runs).toBe(1);
  });

  it("keeps to its times after a run that throws", async () => {
    vi.setSystemTime(new Date("2024-03-10T05:00:00Z"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let runs = 0;
    const job: DailyJob = {
      name: "failing",
      at: 6 * 60,
      zones: () => [],
      run: async () => {
        runs++;
        throw new Error("down");
      },
    };
    stop = startDaily([job]);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(runs).toBe(1); // not retried every tick
    expect(error).toHaveBeenCalled();
  });
});

describe("a job's next run", () => {
  it("is just after the first of its times, in any of its zones, after the last", () => {
    const ran = new Date("2024-03-10T05:00:00Z");
    const job: DailyJob = {
      name: "j",
      at: 9 * 60,
      zones: () => ["Asia/Tokyo"], // 14:00 there: 09:00 is tomorrow's
      times: () => [{ at: 6 * 60 + 30, zone: "UTC" }],
      run: async () => {},
    };
    expect(nextRun(job, ran) - ran.getTime()).toBe(1.5 * HOUR + MINUTE);
  });
});
