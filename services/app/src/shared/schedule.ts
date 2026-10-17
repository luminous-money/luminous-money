/**
 * Recurrence for scheduled transactions, shared by the server (which generates occurrences) and
 * the PWA (which previews and describes them), so both agree.
 *
 * A rule is every N days, weeks, months or years from a start date, until an optional end date:
 *
 * - **weeks** fall on the start date's weekday
 * - **months** fall on the start date's day, or on listed days of the month (`-1` is the last
 *   day); a day past a month's end clamps to its last day
 * - **years** fall on the start date (Feb 29 clamps to the 28th in other years)
 *
 * An occurrence's **nominal** date is the rule's; its **date** is where it lands after weekend
 * handling: a Saturday or Sunday stays, moves to the Friday before, or to the Monday after.
 * Dates are ISO strings (YYYY-MM-DD), computed in UTC so no time zone shifts them.
 */

/** How far ahead "upcoming" looks: the Schedules page, and the grayed rows in ledgers. */
export const UPCOMING_DAYS = 16;

export type Unit = "day" | "week" | "month" | "year";
export type Weekend = "keep" | "before" | "after";

export type Rule = {
  every: number;
  unit: Unit;
  /** For months: days of the month, 1 to 31, or -1 for the last day. Empty: the start's day. */
  days: number[];
  start: string;
  until: string | null;
  weekend: Weekend;
};

export type Occurrence = { nominal: string; date: string };

const DAY_MS = 864e5;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return iso(parse(date) + days * DAY_MS);
}

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The date in `year`/`month` (0-based, may overflow into later years) on `day`, clamped. */
function onDay(year: number, month: number, day: number): string {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  const last = daysInMonth(y, m);
  return iso(Date.UTC(y, m, day === -1 ? last : Math.min(day, last)));
}

/** Why a rule can't be used, or null if it can. */
export function problem(rule: Rule): string | null {
  if (!Number.isInteger(rule.every) || rule.every < 1) return "Repeat every 1 or more";
  if (!/^\d{4}-\d\d-\d\d$/.test(rule.start) || Number.isNaN(parse(rule.start)))
    return "Choose a start date";
  if (rule.until !== null && rule.until < rule.start) return "The end date is before the start";
  if (
    rule.unit === "month" &&
    rule.days.some((d) => d !== -1 && (d < 1 || d > 31 || !Number.isInteger(d)))
  )
    return "Days of the month are 1 to 31, or last";
  return null;
}

/** The rule's nominal dates after `after` (exclusive; null for from the start) through
 * `through` (inclusive), in order. */
export function nominalDates(rule: Rule, after: string | null, through: string): string[] {
  if (problem(rule)) return [];
  const end = rule.until !== null && rule.until < through ? rule.until : through;
  const out: string[] = [];
  const keep = (date: string) => {
    if (
      date >= rule.start &&
      date <= end &&
      (after === null || date > after) &&
      out.at(-1) !== date
    )
      out.push(date);
  };
  const start = new Date(parse(rule.start));
  for (let k = 0; ; k++) {
    let dates: string[];
    if (rule.unit === "day" || rule.unit === "week") {
      const step = rule.unit === "day" ? rule.every : rule.every * 7;
      dates = [addDays(rule.start, k * step)];
    } else if (rule.unit === "month") {
      const month = start.getUTCMonth() + k * rule.every;
      const days = rule.days.length ? rule.days : [start.getUTCDate()];
      dates = days.map((d) => onDay(start.getUTCFullYear(), month, d)).sort();
    } else {
      dates = [
        onDay(start.getUTCFullYear() + k * rule.every, start.getUTCMonth(), start.getUTCDate()),
      ];
    }
    if (dates[0]! > end) break;
    dates.forEach(keep);
  }
  return out;
}

/** Where a date lands after weekend handling. */
export function adjust(date: string, weekend: Weekend): string {
  const day = new Date(parse(date)).getUTCDay(); // 0 Sunday, 6 Saturday
  if (weekend === "keep" || (day !== 0 && day !== 6)) return date;
  if (weekend === "before") return addDays(date, day === 6 ? -1 : -2);
  return addDays(date, day === 6 ? 2 : 1);
}

/** Occurrences whose nominal dates fall after `after` through `through`. */
export function occurrences(rule: Rule, after: string | null, through: string): Occurrence[] {
  return nominalDates(rule, after, through).map((nominal) => ({
    nominal,
    date: adjust(nominal, rule.weekend),
  }));
}

/**
 * The occurrences due by `today`, in order, after `after`: those whose (adjusted) date has
 * come. Stops at the first that hasn't, so a later one is never staged before an earlier one.
 * Looks two days past today, since a weekend occurrence can move to the Friday before.
 */
export function due(rule: Rule, after: string | null, today: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const o of occurrences(rule, after, addDays(today, 2))) {
    if (o.date > today) break;
    out.push(o);
  }
  return out;
}

/** The next `count` occurrences landing on or after `from`. */
export function upcoming(rule: Rule, from: string, count: number, horizonDays = 800): Occurrence[] {
  return occurrences(rule, addDays(from, -3), addDays(from, horizonDays))
    .filter((o) => o.date >= from)
    .slice(0, count);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinal(n: number): string {
  if (n === -1) return "last day";
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

function list(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The rule in words: "Every 2 weeks on Friday", "Every month on the 1st and 15th". */
export function describe(rule: Rule): string {
  const start = new Date(parse(rule.start));
  const unit = rule.every === 1 ? rule.unit : `${rule.every} ${rule.unit}s`;
  let text = `Every ${unit}`;
  if (rule.unit === "week") text += ` on ${WEEKDAYS[start.getUTCDay()]}`;
  if (rule.unit === "month") {
    const days = rule.days.length ? [...rule.days] : [start.getUTCDate()];
    days.sort((a, b) => (a === -1 ? 32 : a) - (b === -1 ? 32 : b));
    text += ` on the ${list(days.map(ordinal))}`;
  }
  if (rule.unit === "year") text += ` on ${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  if (rule.weekend === "before") text += ", weekends moving to the Friday before";
  if (rule.weekend === "after") text += ", weekends moving to the Monday after";
  if (rule.until) text += `, until ${rule.until}`;
  return text;
}

/** A transaction without a date or flag: what each occurrence stages. */
export type TransactionTemplate = {
  payee: string | null;
  narration: string;
  tags: string[];
  links: string[];
  meta: Record<string, unknown>;
  postings: {
    account: string;
    units: { number: string; currency: string } | null;
    /** How far an imported amount may be from this split's, either way, and still match it
     * (a decimal string; absent or "0" for exact). Kept in the schedule, not the books. */
    tolerance?: string | null;
    [more: string]: unknown;
  }[];
};

export type Schedule = {
  id: string;
  book_id: string;
  name: string;
  rule: Rule;
  template: TransactionTemplate;
  paused: boolean;
  /** Stage occurrences confirmed, rather than unconfirmed for review. */
  auto_confirm: boolean;
  /** The last nominal date the schedule ran for: occurrences after it are still to come. Null
   * before the first. */
  last_applied: string | null;
  /** Why the last attempt to stage an occurrence failed, until one succeeds. */
  last_error: string | null;
  /** The next occurrence still to stage, if any. */
  next: Occurrence | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleIn = {
  name: string;
  rule: Rule;
  template: TransactionTemplate;
  paused?: boolean;
  auto_confirm?: boolean;
};

export type SchedulePatch = Partial<ScheduleIn> & { updated_at: string };

/** An occurrence still to come, for the Upcoming list. */
export type UpcomingOccurrence = Occurrence & {
  schedule_id: string;
  name: string;
  template: TransactionTemplate;
};
