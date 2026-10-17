/** Display helpers. */

/** A stored timestamp (microseconds, UTC) as a local date and time. */
export function formatWhen(stamp: string): string {
  const date = new Date(Date.parse(stamp.length > 24 ? `${stamp.slice(0, 23)}Z` : stamp));
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date
  );
}

/** Today, as an ISO date in local time. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** When a bank reported something (Unix seconds), as "today 6:00am", "yesterday 6:02am", or
 * "Oct 12 6:00am". */
export function formatReported(seconds: number, now = new Date()): string {
  const at = new Date(seconds * 1000);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(at)
    .replace(/\s/g, "")
    .toLowerCase();
  const day = (d: Date) => d.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(at) === day(now)) return `today ${time}`;
  if (day(at) === day(yesterday)) return `yesterday ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at);
  return `${date} ${time}`;
}

/** A report's figure (a number in the currency's units) as money: whole units by default
 * ("$6,092"), or with cents. */
export function formatAmount(n: number, currency: string, cents = false): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}
