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
import type { PairedTransfer } from "../../shared/transfers.js";
import type { ReconcileDraft, ReconcileView, Reconciled } from "../../shared/reconcile.js";
import type {
  Breakdown,
  CashFlow,
  LargestTransactions,
  NetWorth,
  SpendingThisMonth,
  TypicalPeriods,
} from "@luminous-money/ledger-graphs-api";
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
  BankComparison,
  ReconcileDraft,
  ReconcileItem,
  ReconcileView,
  Reconciled,
} from "../../shared/reconcile.js";
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
/** Sharing (M13). */
export type Role = "owner" | "manage" | "write" | "read";
export type BookMember = {
  user_id: string;
  role: Role;
  updated_at: string | null;
  name: string | null;
  email: string | null;
};
export type BookInvite = {
  id: string;
  role: Exclude<Role, "owner">;
  /** Whose it is: only the account with this email can accept it. */
  email: string | null;
  label: string | null;
  invited_by: string | null;
  expires_at: string;
  created_at: string;
};
export type Invitation = BookInvite & {
  book: { id: string; name: string };
  state: "open" | "used" | "expired";
  member: boolean;
  /** Whether it names the caller's email. */
  for_you: boolean;
};

export type BreakdownOptions = {
  side: "expenses" | "income";
  depth: number;
  window: "average" | "month";
  /** Drilled into: the accounts just under it. */
  of?: string;
};

export type BookSettings = {
  time_zone: string | null;
  /** 0 Sunday to 6 Saturday. */
  week_start: number;
  updated_at: string | null;
};

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
  /** Divide it (M15): a divided account of the same name, its history in its main part, the
   * other parts given their amounts on `date`. */
  divide: async (
    book: string,
    account: string,
    d: { main: string; parts: { name: string; amount: string }[]; date: string; updated_at: string }
  ): Promise<{ name: string; main_part: string | null }> =>
    json(await apiFetch(`${accountPath(book, account)}/divide`, post(d))),
  /** Make it a divided account (one real account its sub-accounts divide), or not. */
  divided: async (
    book: string,
    account: string,
    divided: boolean,
    updatedAt: string | null
  ): Promise<unknown> =>
    json(
      await apiFetch(
        `${accountPath(book, account)}/divided`,
        post({ divided, updated_at: updatedAt })
      )
    ),
  remove: async (book: string, account: string, substitute?: string): Promise<string[]> =>
    json(
      await apiFetch(
        `${accountPath(book, account)}${substitute ? `?substitute=${encodeURIComponent(substitute)}` : ""}`,
        { method: "DELETE" }
      )
    ),
};

/** Receipts (M16): the file and the hints, read by the ai service if the book has it, staged
 * unconfirmed with the receipt attached. */
export const receipts = {
  capture: async (
    book: string,
    file: Blob,
    filename: string,
    hints: Record<string, string | null | undefined>
  ): Promise<{ transaction_id: string; read: boolean; note: string | null }> => {
    const form = new FormData();
    form.set("file", file, filename);
    for (const [key, value] of Object.entries(hints)) if (value) form.set(key, value);
    return json(await apiFetch(`${base(book)}/receipts`, { method: "POST", body: form }));
  },
};

/** Reconciling an account (M14): the screen's view, saving for later, finishing. */
export const reconciling = {
  view: async (book: string, account: string, through?: string): Promise<ReconcileView> =>
    json(
      await apiFetch(
        `${base(book)}/reconcile/${encodeURIComponent(account)}${through ? `?through=${through}` : ""}`
      )
    ),
  saveDraft: async (
    book: string,
    account: string,
    draft: {
      statement_date: string | null;
      balance: string | null;
      ticked: string[];
      updated_at: string | null;
    }
  ): Promise<ReconcileDraft> =>
    json(
      await apiFetch(
        `${base(book)}/reconcile/${encodeURIComponent(account)}/draft`,
        post(draft, "PUT")
      )
    ),
  discardDraft: async (book: string, account: string): Promise<void> => {
    const response = await apiFetch(
      `${base(book)}/reconcile/${encodeURIComponent(account)}/draft`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) await json(response);
  },
  finish: async (
    book: string,
    account: string,
    statement: { statement_date: string; balance: string; transactions: string[] }
  ): Promise<Reconciled> =>
    json(await apiFetch(`${base(book)}/reconcile/${encodeURIComponent(account)}`, post(statement))),
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
  /** Sharing a book (M13): who has it, and invitations by link. */
  sharing: {
    members: async (
      book: string
    ): Promise<{ role: Role; members: BookMember[]; invites: BookInvite[] }> =>
      json(await apiFetch(`${base(book)}/members`)),
    setRole: async (
      book: string,
      user: string,
      role: BookInvite["role"],
      updatedAt: string
    ): Promise<BookMember> =>
      json(
        await apiFetch(`${base(book)}/members/${encodeURIComponent(user)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role, updated_at: updatedAt }),
        })
      ),
    remove: async (book: string, user: string): Promise<void> => {
      const response = await apiFetch(`${base(book)}/members/${encodeURIComponent(user)}`, {
        method: "DELETE",
      });
      if (!response.ok) await json(response);
    },
    invite: async (
      book: string,
      invite: { role: BookInvite["role"]; email: string; label: string }
    ): Promise<BookInvite & { token: string }> =>
      json(
        await apiFetch(`${base(book)}/invites`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(invite),
        })
      ),
    revoke: async (book: string, id: string): Promise<void> => {
      const response = await apiFetch(`${base(book)}/invites/${id}`, { method: "DELETE" });
      if (!response.ok) await json(response);
    },
    invitation: async (token: string): Promise<Invitation> =>
      json(await apiFetch(`/api/app/v1/invites/${encodeURIComponent(token)}`)),
    accept: async (token: string): Promise<{ book: string }> =>
      json(
        await apiFetch(`/api/app/v1/invites/${encodeURIComponent(token)}/accept`, {
          method: "POST",
        })
      ),
  },

  /** Reports (M12): datasets to draw, measured on `on` (the caller's today). */
  reports: {
    spending: async (book: string, on: string): Promise<SpendingThisMonth> =>
      json(await apiFetch(`${base(book)}/reports/spending?on=${on}`)),
    cashFlow: async (book: string, on: string): Promise<CashFlow> =>
      json(await apiFetch(`${base(book)}/reports/cash-flow?on=${on}`)),
    breakdown: async (book: string, on: string, options: BreakdownOptions): Promise<Breakdown> =>
      json(
        await apiFetch(
          `${base(book)}/reports/breakdown?${new URLSearchParams({
            on,
            side: options.side,
            depth: String(options.depth),
            window: options.window,
            ...(options.of ? { of: options.of } : {}),
          })}`
        )
      ),
    largest: async (book: string, on: string): Promise<LargestTransactions> =>
      json(await apiFetch(`${base(book)}/reports/largest?on=${on}`)),
    netWorth: async (book: string, on: string): Promise<NetWorth> =>
      json(await apiFetch(`${base(book)}/reports/net-worth?on=${on}`)),
    typical: async (book: string, on: string, account: string): Promise<TypicalPeriods> =>
      json(
        await apiFetch(
          `${base(book)}/reports/typical?on=${on}&account=${encodeURIComponent(account)}`
        )
      ),
  },

  /** Transfers paired in review, each with the two transactions it was made of. */
  transfers: async (book: string): Promise<PairedTransfer[]> =>
    json(await apiFetch(`${base(book)}/transfers`)),

  /** Reject a paired transfer: the two it was made of come back in its place. */
  rejectTransfer: async (book: string, id: string): Promise<{ restored: string[] }> =>
    json(await apiFetch(`${base(book)}/transfers/${id}/reject`, { method: "POST" })),

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

  /** The book's settings: its time zone and the day its weeks start (0 Sunday). */
  settings: async (book: string): Promise<BookSettings> =>
    json(await apiFetch(`${base(book)}/settings`)),

  /** Change some of the book's settings, against the version read. */
  patchSettings: async (
    book: string,
    patch: { updated_at: string; time_zone?: string; week_start?: number }
  ): Promise<BookSettings> =>
    json(
      await apiFetch(`${base(book)}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      })
    ),

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

  /** Create or change a rule; the answer says how many unconfirmed transactions it covers. */
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

  /** Suggest categories for unconfirmed transactions (from `account`, if given). */
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
