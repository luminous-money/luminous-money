/**
 * Daily jobs: each runs at a local time of day in the time zones it cares about (each book's),
 * and at startup. A job's run decides for itself what's due, so running it again is harmless.
 * The timer sleeps until the next local time any job has, in any zone.
 */

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

/** Run every job now, then each at its next local time. Returns a stop function. */
export function startDaily(jobs: DailyJob[]): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    for (const job of jobs) {
      try {
        const done = await job.run();
        if (done) console.log(`${job.name}: ${done}`);
      } catch (error) {
        console.error(`${job.name}:`, error);
      }
    }
    const now = new Date();
    const waits = jobs.flatMap((job) => [
      ...[undefined, ...new Set(job.zones())].map((zone) => untilLocal(now, job.at, zone)),
      ...(job.times?.() ?? []).map((t) => untilLocal(now, t.at, t.zone)),
    ]);
    timer = setTimeout(() => void tick(), Math.min(...waits));
  };
  void tick();
  return () => clearTimeout(timer);
}
