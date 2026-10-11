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
  /** The account's CSV profile, or null if it doesn't have one yet. */
  async profile(book: string, account: string): Promise<CsvProfile | null> {
    const response = await fetch(`${base(book)}/profiles/${encodeURIComponent(account)}`);
    if (response.status === 404) return null;
    return json<CsvProfile>(response);
  },

  saveProfile: async (book: string, account: string, profile: CsvProfile): Promise<CsvProfile> =>
    json(
      await fetch(`${base(book)}/profiles/${encodeURIComponent(account)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
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
