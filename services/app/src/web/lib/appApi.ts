/** The app API (imports and CSV profiles), at /api/app/v1 on the same origin. */
import type { CsvProfile, ImportBatch, ImportResult, ProposedMatch } from "../../shared/imports.js";
import {
  UPCOMING_DAYS,
  type Schedule,
  type ScheduleIn,
  type SchedulePatch,
  type UpcomingOccurrence,
} from "../../shared/schedule.js";
import type { CategoryRule, CategoryRuleIn, CategoryRulePatch } from "../../shared/rules.js";
import type { ProposalSummary } from "../../shared/imports.js";
import type { Book } from "@fava-beans/ledger-client";

import type {
  BankConnection,
  BankStatus,
  LinkAttempt,
  LinkPreview,
  LinkRequest,
} from "../../shared/bank-feeds.js";

import { ApiError } from "./ledger.js";
import { apiFetch } from "./session.js";

export type {
  Schedule,
  ScheduleIn,
  SchedulePatch,
  UpcomingOccurrence,
} from "../../shared/schedule.js";
export type { CategoryRule, CategoryRuleIn, RuleConditions } from "../../shared/rules.js";
export type {
  BankAccount,
  BankConnection,
  BankError,
  BankStatus,
  LinkAttempt,
  LinkMode,
  LinkPreview,
  LinkRequest,
} from "../../shared/bank-feeds.js";
export type {
  ProposalSummary,
  CsvProfile,
  ImportBatch,
  ImportResult,
  ImportRow,
  Candidate,
  Outcome,
  ProposedMatch,
} from "../../shared/imports.js";

/** A book: the ledger's, with what the app keeps about it. */
export type BookInfo = Book & { time_zone: string | null };

/** A price run's result: the ledger's, with when it ran. */
export type PriceFetch = {
  ran_on: string;
  at: string;
  result: {
    fetched: { commodity: string; date: string; price: { number: string; currency: string } }[];
    errors: Record<string, string>;
  };
};

/** An import the app couldn't run, with a code for the ones the user can fix. */
export class ImportError extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly code: string | undefined
  ) {
    super(status, message);
  }
}

async function json<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as { detail?: string; code?: string };
  throw new ImportError(
    response.status,
    body.detail ?? `${response.status} ${response.statusText}`,
    body.code
  );
}

const base = (book: string) => `/api/app/v1/books/${encodeURIComponent(book)}`;

const post = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Bank feeds: connections are the user's; links go into a book. */
export const bankFeeds = {
  connections: async (): Promise<BankConnection[]> =>
    json(await apiFetch("/api/app/v1/simplefin/connections")),
  connect: async (setupToken: string): Promise<BankConnection> =>
    json(await apiFetch("/api/app/v1/simplefin/connections", post({ setup_token: setupToken }))),
  disconnect: async (id: string): Promise<void> => {
    const response = await apiFetch(`/api/app/v1/simplefin/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) await json(response);
  },
  sync: async (
    id: string
  ): Promise<{ batches: number; staged: number; matched: number; connection: BankConnection }> =>
    json(
      await apiFetch(`/api/app/v1/simplefin/connections/${encodeURIComponent(id)}/sync`, post({}))
    ),
  preview: async (book: string, link: LinkRequest): Promise<LinkPreview> =>
    json(await apiFetch(`${base(book)}/simplefin/links/preview`, post(link))),
  link: async (book: string, link: LinkRequest): Promise<{ preview: LinkPreview }> =>
    json(await apiFetch(`${base(book)}/simplefin/links`, post(link))),
  unlink: async (book: string, id: string): Promise<void> => {
    const response = await apiFetch(`${base(book)}/simplefin/links/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) await json(response);
  },
  attempts: async (book: string): Promise<LinkAttempt[]> =>
    json(await apiFetch(`${base(book)}/simplefin/attempts`)),
  attempt: async (book: string, link: LinkRequest): Promise<LinkAttempt> =>
    json(await apiFetch(`${base(book)}/simplefin/attempts`, post(link))),
  confirm: async (book: string, id: string): Promise<unknown> =>
    json(
      await apiFetch(`${base(book)}/simplefin/attempts/${encodeURIComponent(id)}/confirm`, post({}))
    ),
  cancel: async (book: string, id: string): Promise<void> => {
    const response = await apiFetch(`${base(book)}/simplefin/attempts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) await json(response);
  },
  status: async (book: string): Promise<Record<string, BankStatus>> =>
    json(await apiFetch(`${base(book)}/simplefin/status`)),
};

const accountPath = (book: string, account: string) =>
  `${base(book)}/accounts/${encodeURIComponent(account)}`;

/** Renaming, archiving and deleting accounts: through the app, so what it keeps by account name
 * follows. */
export const accountChanges = {
  rename: async (book: string, account: string, to: string, updatedAt?: string): Promise<unknown> =>
    json(
      await apiFetch(`${accountPath(book, account)}/rename`, post({ to, updated_at: updatedAt }))
    ),
  archive: async (
    book: string,
    account: string,
    archive: { date?: string; transfer_to?: string; updated_at?: string }
  ): Promise<string[]> =>
    json(await apiFetch(`${accountPath(book, account)}/archive`, post(archive))),
  unarchive: async (book: string, account: string): Promise<string[]> =>
    json(await apiFetch(`${accountPath(book, account)}/unarchive`, post({}))),
  remove: async (book: string, account: string, substitute?: string): Promise<string[]> =>
    json(
      await apiFetch(
        `${accountPath(book, account)}${substitute ? `?substitute=${encodeURIComponent(substitute)}` : ""}`,
        { method: "DELETE" }
      )
    ),
};

export const appApi = {
  /** The user's books, oldest first, with their time zones. */
  books: async (): Promise<BookInfo[]> => json(await apiFetch("/api/app/v1/books")),

  /** A new book in `time_zone`; with `text` (Beancount, e.g. an export), a copy of it. */
  createBook: async (body: { name: string; time_zone: string; text?: string }): Promise<BookInfo> =>
    json(
      await apiFetch("/api/app/v1/books", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ),

  /** Delete the book and everything in it, against the version read. */
  deleteBook: async (book: string, updatedAt: string): Promise<void> => {
    const response = await apiFetch(`${base(book)}?updated_at=${encodeURIComponent(updatedAt)}`, {
      method: "DELETE",
    });
    if (!response.ok) await json(response);
  },

  /** The account's CSV profiles (its bank's file formats), oldest first. */
  profiles: async (book: string, account: string): Promise<CsvProfile[]> =>
    json(await apiFetch(`${base(book)}/profiles/${encodeURIComponent(account)}`)),

  /** Save a profile: in place of the account's others (`replace`), or alongside them (`add`). */
  saveProfile: async (
    book: string,
    account: string,
    profile: CsvProfile,
    mode: "replace" | "add"
  ): Promise<CsvProfile[]> =>
    json(
      await apiFetch(`${base(book)}/profiles/${encodeURIComponent(account)}`, {
        method: mode === "replace" ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "replace" ? [profile] : profile),
      })
    ),

  async importFile(book: string, account: string, file: File): Promise<ImportResult> {
    const form = new FormData();
    form.set("account", account);
    form.set("file", file);
    return json(await apiFetch(`${base(book)}/imports`, { method: "POST", body: form }));
  },

  /** The caller's starred accounts in the book, in the order they were starred. */
  stars: async (book: string): Promise<string[]> => json(await apiFetch(`${base(book)}/stars`)),

  setStar: async (book: string, account: string, starred: boolean): Promise<string[]> =>
    json(
      await apiFetch(`${base(book)}/stars/${encodeURIComponent(account)}`, {
        method: starred ? "PUT" : "DELETE",
      })
    ),

  /** Import rows whose match is up for review. */
  matches: async (book: string): Promise<ProposedMatch[]> =>
    json(await apiFetch(`${base(book)}/matches`)),

  /** Set a row's transaction: a candidate (swapping if another row holds it), or null for a
   * new one. */
  assign: async (book: string, row: ProposedMatch, transaction: string | null) =>
    json<ProposedMatch[]>(
      await apiFetch(`${base(book)}/imports/${row.batch_id}/rows/${row.line}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction }),
      })
    ),

  confirmMatch: async (book: string, row: ProposedMatch) =>
    json<ProposedMatch[]>(
      await apiFetch(`${base(book)}/imports/${row.batch_id}/rows/${row.line}/confirm`, {
        method: "POST",
      })
    ),

  schedules: async (book: string): Promise<Schedule[]> =>
    json(await apiFetch(`${base(book)}/schedules`)),

  schedule: async (book: string, id: string): Promise<Schedule> =>
    json(await apiFetch(`${base(book)}/schedules/${id}`)),

  createSchedule: async (book: string, schedule: ScheduleIn): Promise<Schedule> =>
    json(
      await apiFetch(`${base(book)}/schedules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedule),
      })
    ),

  editSchedule: async (book: string, id: string, patch: SchedulePatch): Promise<Schedule> =>
    json(
      await apiFetch(`${base(book)}/schedules/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      })
    ),

  async deleteSchedule(book: string, schedule: Schedule): Promise<void> {
    const response = await apiFetch(
      `${base(book)}/schedules/${schedule.id}?updated_at=${encodeURIComponent(schedule.updated_at)}`,
      { method: "DELETE" }
    );
    if (!response.ok) await json(response);
  },

  upcoming: async (book: string, days = UPCOMING_DAYS): Promise<UpcomingOccurrence[]> =>
    json(await apiFetch(`${base(book)}/schedules/upcoming?days=${days}`)),

  /** Transaction ID to schedule ID, for every transaction a schedule staged. */
  scheduled: async (book: string): Promise<Record<string, string>> =>
    json(await apiFetch(`${base(book)}/schedules/occurrences`)),

  /** The book's time zone (IANA), or null if it was never set. */
  timeZone: async (book: string): Promise<string | null> =>
    (await json<{ time_zone: string | null }>(await apiFetch(`${base(book)}/settings`))).time_zone,

  setTimeZone: async (book: string, timeZone: string): Promise<string> =>
    (
      await json<{ time_zone: string }>(
        await apiFetch(`${base(book)}/settings`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ time_zone: timeZone }),
        })
      )
    ).time_zone,

  rules: async (book: string): Promise<CategoryRule[]> =>
    json(await apiFetch(`${base(book)}/rules`)),

  rule: async (book: string, id: string): Promise<CategoryRule> =>
    json(await apiFetch(`${base(book)}/rules/${id}`)),

  /** Create or change a rule; the answer says how many pending transactions it covers. */
  saveRule: async (
    book: string,
    rule: CategoryRuleIn | CategoryRulePatch,
    id?: string
  ): Promise<CategoryRule & { covers: number }> =>
    json(
      await apiFetch(`${base(book)}/rules${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rule),
      })
    ),

  async deleteRule(book: string, rule: CategoryRule): Promise<void> {
    const response = await apiFetch(
      `${base(book)}/rules/${rule.id}?updated_at=${encodeURIComponent(rule.updated_at)}`,
      { method: "DELETE" }
    );
    if (!response.ok) await json(response);
  },

  applyRule: async (book: string, id: string): Promise<{ applied: number }> =>
    json(await apiFetch(`${base(book)}/rules/${id}/apply`, { method: "POST" })),

  /** Transaction ID to what categorization proposed, for transactions still waiting. */
  proposals: async (book: string): Promise<Record<string, ProposalSummary>> =>
    json(await apiFetch(`${base(book)}/proposals`)),

  /** Record whether a confirmed transaction kept its proposal (no proposal: nothing to do). */
  settle: async (book: string, transaction: string): Promise<void> => {
    await apiFetch(`${base(book)}/proposals/${transaction}/settle`, { method: "POST" });
  },

  /** Suggest categories for pending transactions (from `account`, if given). */
  suggest: async (book: string, account?: string): Promise<{ suggested: number }> =>
    json(
      await apiFetch(
        `${base(book)}/suggest${account ? `?account=${encodeURIComponent(account)}` : ""}`,
        { method: "POST" }
      )
    ),

  categorizers: async (
    book: string
  ): Promise<{ name: string; settled: number; accepted: number }[]> =>
    json(await apiFetch(`${base(book)}/categorizers`)),

  /** The last morning price run (or "fetch now"): when, and what it fetched or couldn't. */
  lastPriceFetch: async (book: string): Promise<PriceFetch | null> =>
    json(await apiFetch(`${base(book)}/prices/fetch`)),

  fetchPricesNow: async (book: string): Promise<PriceFetch> =>
    json(await apiFetch(`${base(book)}/prices/fetch`, { method: "POST" })),

  lastImports: async (book: string): Promise<Record<string, string>> =>
    json(await apiFetch(`${base(book)}/imports/latest`)),

  batches: async (book: string, account?: string): Promise<ImportBatch[]> =>
    json(
      await apiFetch(
        `${base(book)}/imports${account ? `?account=${encodeURIComponent(account)}` : ""}`
      )
    ),
};
