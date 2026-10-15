/**
 * Slowing down guessing, in memory (one `auth` process):
 *
 * - **Failures** (wrong passwords), per key: after `free` of them, each further attempt must wait
 *   longer (1 s, 2 s, 4 s, ... up to 15 minutes). A success clears the key.
 * - **Rates** (sign-ups, password-reset requests): at most `limit` per hour per key.
 */
const HOUR = 60 * 60 * 1000;
const MAX_WAIT = 15 * 60 * 1000;

export class Failures {
  private readonly entries = new Map<string, { count: number; until: number; seen: number }>();

  constructor(private readonly free: number) {}

  /** Milliseconds to wait before `key` may try again (0: go ahead). */
  wait(key: string, at = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (entry.seen + HOUR < at) {
      this.entries.delete(key);
      return 0;
    }
    return Math.max(0, entry.until - at);
  }

  fail(key: string, at = Date.now()): void {
    const entry = this.entries.get(key) ?? { count: 0, until: 0, seen: at };
    entry.count += 1;
    entry.seen = at;
    if (entry.count >= this.free)
      entry.until = at + Math.min(1000 * 2 ** (entry.count - this.free), MAX_WAIT);
    this.entries.set(key, entry);
    if (this.entries.size > 100_000) this.prune(at);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  private prune(at: number): void {
    for (const [key, entry] of this.entries) if (entry.seen + HOUR < at) this.entries.delete(key);
  }
}

export class Rate {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number) {}

  /** Count a hit for `key`; false if it's over the limit (and not counted). */
  allow(key: string, at = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => t + HOUR > at);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(key, recent);
    return true;
  }
}
