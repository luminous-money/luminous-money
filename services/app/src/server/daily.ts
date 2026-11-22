/**
 * Daily jobs: each runs at a local time of day in the time zones it cares about (each book's),
 * and at startup. A job's run decides for itself what's due, so running it again is harmless.
 *
 * The timer wakes every `TICK` and runs each job one of whose times has come since it last ran,
 * by the clock on the wall. It never sleeps until the next time outright: a timer counts only
 * the time the machine is awake, so a laptop closed overnight would run the morning's syncs
 * as many hours late as it slept. The first run waits for the services the jobs call (`ready`).
 */
import { probe } from "./health.js";

export type DailyJob = {
  name: string;
  /** When it runs, in minutes past local midnight. */
  at: number;
  /** The time zones it runs in (undefined: the app's own). */
  zones(): (string | undefined)[];
  /** More local times it wants to wake at, beyond `at` in its zones (e.g. one per bank
   * connection, at its own minute). */
  times?(): { at: number; zone: string | undefined }[];
  /** Do whatever is due; returns a line to log, if anything happened. */
  run(): Promise<string | void>;
};

/** The local time of day in `timeZone` (or the app's), in seconds past midnight. */
function localSeconds(now: Date, timeZone?: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)])
  );
  return parts.hour! * 3600 + parts.minute! * 60 + parts.second!;
}

/** Milliseconds from `now` until just after (a minute past) the next `at` minutes past local
 * midnight in `timeZone`. */
export function untilLocal(now: Date, at: number, timeZone?: string): number {
  const elapsed = localSeconds(now, timeZone);
  let wait = at * 60 - elapsed;
  if (wait <= 0) wait += 24 * 3600;
  return wait * 1000 - now.getMilliseconds() + 60_000;
}

/** Minutes past local midnight in `timeZone`, now. */
export function localMinutes(now: Date, timeZone?: string): number {
  return Math.floor(localSeconds(now, timeZone) / 60);
}

/** How often the timer wakes to see what's come due. */
export const TICK = 10 * 60_000;

/** When `job` is next due after a run at `ran`: just after the first of its times since. */
export function nextRun(job: DailyJob, ran: Date): number {
  const waits = [
    ...[undefined, ...new Set(job.zones())].map((zone) => untilLocal(ran, job.at, zone)),
    ...(job.times?.() ?? []).map((t) => untilLocal(ran, t.at, t.zone)),
  ];
  return ran.getTime() + Math.min(...waits);
}

/** Resolves once each of `urls` answers `/health`, or after `limit` ms, whichever is first. */
export async function healthy(urls: string[], limit = 120_000, every = 2_000): Promise<void> {
  const until = Date.now() + limit;
  while (Date.now() < until) {
    const probed = await Promise.all(urls.map((url) => probe(url)));
    if (probed.every((p) => p.status === "up")) return;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  console.warn(`daily jobs: starting without ${urls.join(", ")} answering`);
}

/** Run every job once `ready` resolves, then each when one of its times comes. Returns a stop
 * function. */
export function startDaily(jobs: DailyJob[], ready: Promise<void> = Promise.resolve()): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // When each job last ran (none yet: due now). Its next time is worked out again each tick, so
  // a time added since (a bank connection linked, say) counts.
  const ran = new Map<DailyJob, Date>();
  const due = (job: DailyJob) => {
    const last = ran.get(job);
    return last ? nextRun(job, last) : 0;
  };
  const tick = async () => {
    for (const job of jobs) {
      if (Date.now() < due(job)) continue;
      try {
        const done = await job.run();
        if (done) console.log(`${job.name}: ${done}`);
      } catch (error) {
        console.error(`${job.name}:`, error);
      }
      ran.set(job, new Date());
    }
    if (stopped) return;
    const next = Math.min(...jobs.map(due)) - Date.now();
    timer = setTimeout(() => void tick(), Math.max(0, Math.min(next, TICK)));
  };
  void ready.then(() => {
    if (!stopped) void tick();
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
