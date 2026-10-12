/** The app API (imports and CSV profiles), at /api/app/v1 on the same origin. */
import type { CsvProfile, ImportBatch, ImportResult } from "../../shared/imports.js";
import { ApiError } from "./ledger.js";

export type {
  CsvProfile,
  ImportBatch,
  ImportResult,
  ImportRow,
  Candidate,
  Outcome,
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

  lastImports: async (book: string): Promise<Record<string, string>> =>
    json(await fetch(`${base(book)}/imports/latest`)),

  batches: async (book: string, account?: string): Promise<ImportBatch[]> =>
    json(
      await fetch(
        `${base(book)}/imports${account ? `?account=${encodeURIComponent(account)}` : ""}`
      )
    ),
};
