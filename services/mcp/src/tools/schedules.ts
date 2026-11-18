/** Scheduled transactions: what repeats, and what's coming up. */
import {
  ACCOUNT,
  AMOUNT,
  BOOK,
  UPDATED_AT,
  bool,
  date,
  int,
  ledgerSchema,
  obj,
  oneOf,
  str,
  strs,
  type JsonSchema,
} from "../schemas.js";
import { seg, type Tool } from "../tool.js";

/** When a schedule repeats (services/app/src/shared/schedule.ts's Rule). */
export const RECURRENCE = obj(
  {
    every: int("Every how many units: 1 or more."),
    unit: oneOf(["day", "week", "month", "year"], "The unit."),
    days: {
      type: "array",
      items: { type: "integer" },
      description: "Months: days of the month (1-31, -1 the last); empty for the start's day.",
    },
    start: date("The first date."),
    until: { type: ["string", "null"], format: "date", description: "The last date, or null." },
    weekend: oneOf(
      ["keep", "before", "after"],
      "A Saturday or Sunday stays, moves to the Friday before, or the Monday after."
    ),
  },
  ["every", "unit", "days", "start", "until", "weekend"]
);

/** What each occurrence stages: a transaction without a date or flag. */
export const TEMPLATE = obj(
  {
    payee: { type: ["string", "null"] },
    narration: str("What it's for."),
    links: strs("Links (usually none)."),
    funds: (ledgerSchema("TransactionIn").properties as Record<string, JsonSchema>).funds!,
    meta: { type: "object", description: "Metadata (usually {})." },
    postings: {
      type: "array",
      items: obj(
        {
          account: ACCOUNT,
          units: {
            type: ["object", "null"],
            properties: { number: AMOUNT, currency: str("USD") },
            required: ["number", "currency"],
            description: "Null on one split to take the rest.",
          },
          tolerance: {
            type: ["string", "null"],
            description: "How far an imported amount may be from this, either way, and match.",
          },
          tags: strs("Its tags."),
        },
        ["account", "units"]
      ),
    },
  },
  ["payee", "narration", "links", "meta", "postings"]
);

export const SCHEDULE: Record<string, JsonSchema> = {
  name: str("What it's called."),
  rule: RECURRENCE,
  template: TEMPLATE,
  paused: bool("Paused: stages nothing."),
  auto_confirm: bool("Stage occurrences confirmed, rather than for review."),
};

const schedules = (book: unknown) => `/books/${seg(book)}/schedules`;

export const scheduleTools: Tool[] = [
  {
    name: "read_schedules",
    domain: "schedules",
    description: "The book's schedules: each one's recurrence, template, next occurrence, state.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(schedules(book)),
  },
  {
    name: "read_upcoming",
    domain: "schedules",
    description: "Occurrences still to come over the next days (16 by default), in order.",
    input: { book: BOOK, days: int("How many days ahead (at most 366).") },
    required: ["book"],
    run: (ctx, { book, days }) =>
      ctx.app.get(`${schedules(book)}/upcoming`, { days: days as number | undefined }),
  },
  {
    name: "write_add_schedule",
    domain: "schedules",
    description: "Make a schedule; any occurrences already due (from its start) are staged.",
    input: { book: BOOK, schedule: obj(SCHEDULE, ["name", "rule", "template"]) },
    required: ["book", "schedule"],
    additive: true,
    run: (ctx, { book, schedule }) => ctx.app.post(schedules(book), schedule),
  },
  {
    name: "write_edit_schedule",
    domain: "schedules",
    description:
      "Change a schedule (only the fields given), against its `updated_at`: occurrences still " +
      "to come follow.",
    input: {
      book: BOOK,
      id: str("The schedule's ID."),
      changes: obj(
        { updated_at: UPDATED_AT },
        ["updated_at"],
        "The fields of write_add_schedule's `schedule` to change (name, rule, template, paused, " +
          "auto_confirm), with the `updated_at` you read."
      ),
    },
    required: ["book", "id", "changes"],
    run: (ctx, { book, id, changes }) => ctx.app.patch(`${schedules(book)}/${seg(id)}`, changes),
  },
  {
    name: "write_run_schedules",
    domain: "schedules",
    description: "Stage the book's due occurrences now (it's also done hourly).",
    input: { book: BOOK },
    required: ["book"],
    additive: true,
    run: (ctx, { book }) => ctx.app.post(`${schedules(book)}/run`),
  },
  {
    name: "delete_schedule",
    domain: "schedules",
    description: "Delete a schedule (what it staged stays). A loan's goes with the loan instead.",
    input: { book: BOOK, id: str("The schedule's ID."), updated_at: UPDATED_AT },
    required: ["book", "id", "updated_at"],
    run: async (ctx, { book, id, updated_at }) => {
      await ctx.app.delete(`${schedules(book)}/${seg(id)}`, { updated_at: updated_at as string });
      return { deleted: id };
    },
  },
];
