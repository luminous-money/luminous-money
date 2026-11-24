/**
 * The ai service (M16), at /api/ai/v1 on the same origin: its health (what the PWA checks before
 * offering anything AI), each book's AI settings and the key it uses, and the caller's own keys
 * (shared connections: a key is a person's). Receipts go through `app` (appApi.ts), which stages
 * what the service reads.
 */
import {
  formatUsd,
  type AiCredential,
  type AiHealth,
  type AiSettings,
  type AiSettingsPatch,
  type AiUsage,
} from "@luminous-money/ai-api";

import { statusMessage } from "./format.js";
import { ApiError } from "./ledger.js";
import { apiFetch } from "./session.js";

export type {
  AiCredential,
  AiHealth,
  AiSettings,
  AiSettingsPatch,
  Eagerness,
} from "@luminous-money/ai-api";

const base = (book: string) => `/api/ai/v1/books/${encodeURIComponent(book)}`;

async function json<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as { detail?: string };
  throw new ApiError(
    response.status,
    body.detail ?? statusMessage(response.status, response.statusText)
  );
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** What an operation's AI calls cost, as a sentence: "The AI's part cost about $0.03." */
export const aiCostSentence = (usd: number) => `The AI's part cost about ${formatUsd(usd)}.`;

export { formatUsd };

export const aiApi = {
  /** What the book's AI has cost this month (UTC). */
  usage: async (book: string): Promise<AiUsage> => json(await apiFetch(`${base(book)}/usage`)),
  /** Up, or not: null when the service can't be reached (it's optional). */
  health: async (): Promise<AiHealth | null> => {
    try {
      const response = await apiFetch("/api/ai/v1/health");
      return response.ok ? ((await response.json()) as AiHealth) : null;
    } catch {
      return null;
    }
  },
  settings: async (book: string): Promise<AiSettings> =>
    json(await apiFetch(`${base(book)}/settings`)),
  patch: async (book: string, patch: AiSettingsPatch): Promise<AiSettings> =>
    json(await apiFetch(`${base(book)}/settings`, send("PATCH", patch))),
  /** The book's key: a new one of the caller's (`api_key`), or one of theirs (`credential_id`). */
  setKey: async (
    book: string,
    key: { api_key: string } | { credential_id: string }
  ): Promise<AiSettings> => json(await apiFetch(`${base(book)}/credential`, send("PUT", key))),
  clearKey: async (book: string): Promise<AiSettings> =>
    json(await apiFetch(`${base(book)}/credential`, send("DELETE"))),
  /** The caller's own keys, with the books using each. */
  keys: async (): Promise<AiCredential[]> => json(await apiFetch("/api/ai/v1/credentials")),
  deleteKey: async (id: string): Promise<void> => {
    const response = await apiFetch(
      `/api/ai/v1/credentials/${encodeURIComponent(id)}`,
      send("DELETE")
    );
    if (!response.ok) await json(response);
  },
};
