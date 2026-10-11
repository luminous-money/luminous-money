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
