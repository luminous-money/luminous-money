/** The app API (imports and CSV profiles), at /api/app/v1 on the same origin. */
import type { CsvProfile, ImportBatch, ImportResult, ProposedMatch } from "../../shared/imports.js";
import type {
  Schedule,
  ScheduleIn,
  SchedulePatch,
  UpcomingOccurrence,
} from "../../shared/schedule.js";
import { ApiError } from "./ledger.js";

export type {
  Schedule,
  ScheduleIn,
  SchedulePatch,
  UpcomingOccurrence,
} from "../../shared/schedule.js";
export type {
  CsvProfile,
  ImportBatch,
  ImportResult,
  ImportRow,
  Candidate,
  Outcome,
  ProposedMatch,
} from "../../shared/imports.js";

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

export const appApi = {
  /** The account's CSV profiles (its bank's file formats), oldest first. */
  profiles: async (book: string, account: string): Promise<CsvProfile[]> =>
    json(await fetch(`${base(book)}/profiles/${encodeURIComponent(account)}`)),

  /** Save a profile: in place of the account's others (`replace`), or alongside them (`add`). */
  saveProfile: async (
    book: string,
    account: string,
    profile: CsvProfile,
    mode: "replace" | "add"
  ): Promise<CsvProfile[]> =>
    json(
      await fetch(`${base(book)}/profiles/${encodeURIComponent(account)}`, {
        method: mode === "replace" ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "replace" ? [profile] : profile),
      })
    ),

  async importFile(book: string, account: string, file: File): Promise<ImportResult> {
    const form = new FormData();
    form.set("account", account);
    form.set("file", file);
    return json(await fetch(`${base(book)}/imports`, { method: "POST", body: form }));
  },

  /** The caller's starred accounts in the book, in the order they were starred. */
  stars: async (book: string): Promise<string[]> => json(await fetch(`${base(book)}/stars`)),

  setStar: async (book: string, account: string, starred: boolean): Promise<string[]> =>
    json(
      await fetch(`${base(book)}/stars/${encodeURIComponent(account)}`, {
        method: starred ? "PUT" : "DELETE",
      })
    ),

  /** Import rows whose match is up for review. */
  matches: async (book: string): Promise<ProposedMatch[]> =>
    json(await fetch(`${base(book)}/matches`)),

  /** Set a row's transaction: a candidate (swapping if another row holds it), or null for a
   * new one. */
  assign: async (book: string, row: ProposedMatch, transaction: string | null) =>
    json<ProposedMatch[]>(
      await fetch(`${base(book)}/imports/${row.batch_id}/rows/${row.line}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction }),
      })
    ),

  confirmMatch: async (book: string, row: ProposedMatch) =>
    json<ProposedMatch[]>(
      await fetch(`${base(book)}/imports/${row.batch_id}/rows/${row.line}/confirm`, {
        method: "POST",
      })
    ),

  schedules: async (book: string): Promise<Schedule[]> =>
    json(await fetch(`${base(book)}/schedules`)),

  schedule: async (book: string, id: string): Promise<Schedule> =>
    json(await fetch(`${base(book)}/schedules/${id}`)),

  createSchedule: async (book: string, schedule: ScheduleIn): Promise<Schedule> =>
    json(
      await fetch(`${base(book)}/schedules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedule),
      })
    ),

  editSchedule: async (book: string, id: string, patch: SchedulePatch): Promise<Schedule> =>
    json(
      await fetch(`${base(book)}/schedules/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      })
    ),

  async deleteSchedule(book: string, schedule: Schedule): Promise<void> {
    const response = await fetch(
      `${base(book)}/schedules/${schedule.id}?updated_at=${encodeURIComponent(schedule.updated_at)}`,
      { method: "DELETE" }
    );
    if (!response.ok) await json(response);
  },

  upcoming: async (book: string, days = 30): Promise<UpcomingOccurrence[]> =>
    json(await fetch(`${base(book)}/schedules/upcoming?days=${days}`)),

  /** Transaction ID to schedule ID, for every transaction a schedule staged. */
  scheduled: async (book: string): Promise<Record<string, string>> =>
    json(await fetch(`${base(book)}/schedules/occurrences`)),

  lastImports: async (book: string): Promise<Record<string, string>> =>
    json(await fetch(`${base(book)}/imports/latest`)),

  batches: async (book: string, account?: string): Promise<ImportBatch[]> =>
    json(
      await fetch(
        `${base(book)}/imports${account ? `?account=${encodeURIComponent(account)}` : ""}`
      )
    ),
};
