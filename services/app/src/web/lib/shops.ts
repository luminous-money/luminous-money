/**
 * The shops service (the Amazon orders spike, 2026-11-06), at /api/shops/v1 on the same origin:
 * a book's Amazon connection, syncing it, and what it read. Optional: when it can't be reached,
 * the Amazon page says so.
 */
import { statusMessage } from "./format.js";
import { ApiError } from "./ledger.js";
import { apiFetch } from "./session.js";

export type AmazonConnection = {
  email: string;
  has_password: boolean;
  has_otp_secret: boolean;
  sync_from: string | null;
  other_payments: string;
  rewards: string | null;
  status: "new" | "ok" | "login" | "failed";
  status_detail: string | null;
  last_sync_at: string | null;
  updated_at: string | null;
  /** Whether the service has a key to seal the password with. */
  sealing: boolean;
};

export type AmazonPatch = {
  updated_at: string | null;
  email?: string;
  password?: string;
  otp_secret?: string;
  sync_from?: string | null;
  other_payments?: string;
  rewards?: string | null;
};

export type AmazonSync = {
  state: "none" | "running" | "done" | "failed";
  step?: string;
  error?: string;
  result?: { charges: number; new_charges: number; orders: number; failed: string[] };
  started_at?: string;
  finished_at?: string;
};

export type AmazonItem = {
  title: string;
  quantity: number | null;
  price: string | null;
  asin: string | null;
  link: string | null;
};

export type AmazonOrder = {
  order_number: string;
  placed: string | null;
  link: string | null;
  payment_method: string | null;
  last4: string | null;
  cancelled: boolean;
  whole_foods: boolean;
  totals: Record<string, string | null>;
  items: AmazonItem[];
  shipments: { id: string | null; status: string | null; items: AmazonItem[] }[];
  parse_failures: string[];
};

export type AmazonCharge = {
  id: string;
  date: string;
  /** Amazon's sign: negative a charge, positive a refund. */
  amount: string;
  payment_method: string | null;
  last4: string | null;
  order_number: string | null;
  seller: string | null;
  order_link: string | null;
  order: AmazonOrder | null;
};

/** Amazon's links are often relative to its site. */
export const amazonUrl = (link: string | null) =>
  link ? (link.startsWith("/") ? `https://www.amazon.com${link}` : link) : null;

const base = (book: string) => `/api/shops/v1/books/${encodeURIComponent(book)}/amazon`;

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

export const shopsApi = {
  /** Up, or not: null when the service can't be reached (it's optional). */
  health: async (): Promise<{ status: string; version: string } | null> => {
    try {
      const response = await apiFetch("/api/shops/v1/health");
      return response.ok ? ((await response.json()) as { status: string; version: string }) : null;
    } catch {
      return null;
    }
  },
  amazon: async (book: string): Promise<AmazonConnection> => json(await apiFetch(base(book))),
  patchAmazon: async (book: string, patch: AmazonPatch): Promise<AmazonConnection> =>
    json(await apiFetch(base(book), send("PATCH", patch))),
  forgetAmazon: async (book: string, updatedAt: string): Promise<void> => {
    const response = await apiFetch(
      `${base(book)}?updated_at=${encodeURIComponent(updatedAt)}`,
      send("DELETE")
    );
    if (!response.ok) await json(response);
  },
  sync: async (book: string): Promise<AmazonSync> =>
    json(await apiFetch(`${base(book)}/sync`, send("POST"))),
  syncState: async (book: string): Promise<AmazonSync> =>
    json(await apiFetch(`${base(book)}/sync`)),
  charges: async (book: string): Promise<AmazonCharge[]> =>
    json(await apiFetch(`${base(book)}/charges`)),
};
