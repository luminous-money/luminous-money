/**
 * What `app` asks the ai service (M16), as an interface (so receipts can be tested against a
 * fake), and its real implementation over HTTP, acting as the user. The service is optional:
 * when it's down (or not deployed), `settings` says null and receipts are made without it.
 */
import type {
  AiCost,
  AiSettings,
  CategorizeIn,
  CategorizeOut,
  ExtractIn,
  ExtractOut,
  LoanTableIn,
  LoanTableOut,
} from "@luminous-money/ai-api";

/** An answer (with what it cost, in it), or why there isn't one (and what trying cost, if the
 * service said). */
export type Answer<T> = { ok: T } | { failed: string; cost?: AiCost };

export interface AiPort {
  /** The book's AI settings, or null if the service can't be reached. */
  settings(book: string): Promise<AiSettings | null>;
  /** What a receipt says. */
  extract(book: string, input: ExtractIn): Promise<Answer<ExtractOut>>;
  /** Where transactions' unconfirmed splits belong. */
  categorize(book: string, input: CategorizeIn): Promise<Answer<CategorizeOut>>;
  /** What a loan's amortization schedule says. */
  loanTable(book: string, input: LoanTableIn): Promise<Answer<LoanTableOut>>;
  /** Forget a deleted book. */
  forgetBook(book: string): Promise<void>;
}

export function httpAi(baseUrl: string, userId: string): AiPort {
  const call = (path: string, init: RequestInit = {}, timeout = 180_000) =>
    fetch(`${baseUrl}/api/ai/v1${path}`, {
      ...init,
      headers: { "X-User-Id": userId, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(timeout),
    });
  const post = async <T>(path: string, body: unknown, timeout?: number): Promise<Answer<T>> => {
    try {
      const response = await call(path, { method: "POST", body: JSON.stringify(body) }, timeout);
      if (response.ok) return { ok: (await response.json()) as T };
      const answer = (await response.json().catch(() => ({}))) as {
        detail?: string;
        cost?: AiCost;
      };
      return {
        failed: answer.detail ?? `the AI service said ${response.status}`,
        ...(answer.cost ? { cost: answer.cost } : {}),
      };
    } catch {
      return { failed: "the AI service couldn't be reached" };
    }
  };
  const books = (book: string) => `/books/${encodeURIComponent(book)}`;
  return {
    async settings(book) {
      try {
        const response = await call(`${books(book)}/settings`);
        return response.ok ? ((await response.json()) as AiSettings) : null;
      } catch {
        return null;
      }
    },
    extract: (book, input) => post(`${books(book)}/receipts/extract`, input),
    categorize: (book, input) => post(`${books(book)}/categorize`, input),
    // A 30-year schedule is 360 rows to write out: it can take several minutes.
    loanTable: (book, input) => post(`${books(book)}/loans/extract`, input, 900_000),
    async forgetBook(book) {
      await call(books(book), { method: "DELETE" }).catch(() => undefined);
    },
  };
}
