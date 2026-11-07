/** Display helpers. */

/** A stored timestamp (UTC unless it says otherwise) as a local date and time. One that can't
 * be read is shown as it is, rather than taking the page down. */
export function formatWhen(stamp: string): string {
  // Dates read at most milliseconds (Python writes microseconds), and a time without a zone as
  // local. Its zone may be `Z` or an offset (`+00:00`: the backup's, 2026-11-06).
  const iso = stamp.replace(/(\.\d{3})\d+/, "$1");
  const zoned = /[T ]\d\d:\d\d/.test(iso) && !/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? `${iso}Z` : iso;
  const date = new Date(zoned);
  if (Number.isNaN(date.getTime())) return stamp;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date
  );
}

/** An ISO date as its month: "Sep 2024". Read in UTC, as it's written, so the 1st isn't the
 * last day of the month before west of Greenwich. */
export function formatMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** An ISO date with its year, always: "Sep 1, 2024" (a table's rows, years apart). */
export function formatFullDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** An ISO date as a short day: "Sep 30", with the year if it isn't this one. */
export function formatDay(iso: string, now = new Date()): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(year === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
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

/**
 * What a failed response means, when its body doesn't say (a proxy's error page, say: Emmer's
 * nginx answered a long receipt read with a bare "504 Gateway Time-out", 2026-11-02).
 */
export function statusMessage(status: number, statusText = ""): string {
  const code = `${status}${statusText ? ` ${statusText}` : ""}`;
  if (status === 502)
    return `The server couldn't reach the app behind it (${code}): it may be restarting. Try again in a minute.`;
  if (status === 503)
    return `The server isn't taking requests right now (${code}): it may be restarting. Try again in a minute.`;
  if (status === 504)
    return `The server stopped waiting for an answer (${code}). What you asked for may still finish: look before trying again.`;
  if (status === 413) return `That's more than the server takes in one request (${code}).`;
  if (status >= 500) return `Something went wrong on the server (${code}).`;
  return `The server refused that (${code}).`;
}
