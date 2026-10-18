/**
 * What `app` asks the ai service (M16), as an interface (so receipts can be tested against a
 * fake), and its real implementation over HTTP, acting as the user. The service is optional:
 * when it's down (or not deployed), `settings` says null and receipts are made without it.
 */
import type { AiSettings, ReceiptReadIn, ReceiptReading } from "@fava-beans/ai-api";

export type ReadResult = { reading: ReceiptReading } | { failed: string };

export interface AiPort {
  /** The book's AI settings, or null if the service can't be reached. */
  settings(book: string): Promise<AiSettings | null>;
  /** Read a receipt, or say why it couldn't be. */
  read(book: string, input: ReceiptReadIn): Promise<ReadResult>;
  /** Forget a deleted book. */
  forgetBook(book: string): Promise<void>;
}

export function httpAi(baseUrl: string, userId: string): AiPort {
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}/api/ai/v1${path}`, {
      ...init,
      headers: { "X-User-Id": userId, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(120_000),
    });
  return {
    async settings(book) {
      try {
        const response = await call(`/books/${encodeURIComponent(book)}/settings`);
        return response.ok ? ((await response.json()) as AiSettings) : null;
      } catch {
        return null;
      }
    },
    async read(book, input) {
      try {
        const response = await call(`/books/${encodeURIComponent(book)}/receipts/read`, {
          method: "POST",
          body: JSON.stringify(input),
        });
        if (response.ok) return { reading: (await response.json()) as ReceiptReading };
        const body = (await response.json().catch(() => ({}))) as { detail?: string };
        return { failed: body.detail ?? `the AI service said ${response.status}` };
      } catch {
        return { failed: "the AI service couldn't be reached" };
      }
    },
    async forgetBook(book) {
      await call(`/books/${encodeURIComponent(book)}`, { method: "DELETE" }).catch(() => undefined);
    },
  };
}
