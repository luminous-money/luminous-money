/**
 * External categorization providers: HTTP services implementing the categorizer API
 * (docs/categorizer-api.md), configured per installation with `CATEGORIZERS`, a JSON list:
 *
 *     CATEGORIZERS='[{"name": "cati", "url": "http://cati:8080", "token": "…", "timeout_ms": 30000,
 *                     "feedback": true}]'
 *
 * They run in that order, after the built-in ones. A provider that errors or times out is
 * skipped for the batch.
 */
import type {
  CategorizeRequest,
  CategorizeResponse,
  FeedbackRequest,
} from "../../shared/categorizer-api.js";
import type { Categorizer, Request } from "./types.js";

export type ProviderConfig = {
  /** Unique; shown in review as where a proposal came from. */
  name: string;
  /** The provider's base URL: `/v1/categorize` and `/v1/feedback` are under it. */
  url: string;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** How long to wait for an answer (default 30 seconds). */
  timeout_ms?: number;
  /** Whether to send it feedback on its proposals. */
  feedback?: boolean;
};

const RESERVED = new Set(["rules", "history"]);

/** The configured providers, from `CATEGORIZERS`; throws on a bad configuration, so a typo
 * stops the app at startup instead of silently categorizing less. */
export function providersFrom(json: string | undefined): ProviderConfig[] {
  if (!json?.trim()) return [];
  const list = JSON.parse(json) as ProviderConfig[];
  if (!Array.isArray(list)) throw new Error("CATEGORIZERS must be a JSON list");
  const names = new Set<string>();
  for (const p of list) {
    if (!p?.name || !p.url) throw new Error("each categorizer needs a name and a url");
    if (RESERVED.has(p.name) || names.has(p.name))
      throw new Error(`categorizer name ${p.name} is taken`);
    names.add(p.name);
    new URL(p.url);
  }
  return list;
}

export function external(config: ProviderConfig, fetchImpl: typeof fetch = fetch): Categorizer {
  const call = async (path: string, body: unknown) => {
    const response = await fetchImpl(`${config.url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeout_ms ?? 30_000),
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response;
  };
  return {
    name: config.name,
    async categorize(request: Request) {
      // The API's request (v1): the transactions without their splits, the history without
      // memos. With several splits to place, a one-posting answer is the fallback.
      const v1: CategorizeRequest = {
        ...request,
        transactions: request.transactions.map(({ splits: _s, ...t }) => t),
        context: {
          ...request.context,
          accounts: request.context.accounts.map(({ name, type, kind, open, close }) => ({
            name,
            type,
            kind,
            open,
            close,
          })),
          history: request.context.history.map((t) => ({
            ...t,
            postings: t.postings.map(({ account, amount }) => ({ account, amount })),
          })),
        },
      };
      const answer = (await (await call("/v1/categorize", v1)).json()) as CategorizeResponse;
      if (!Array.isArray(answer?.proposals)) throw new Error("the answer has no proposals list");
      // Only what the API allows: a provider can't auto-confirm.
      return {
        proposals: answer.proposals.map(({ id, postings, payee, confidence, reason }) => ({
          id,
          ...(postings ? { postings } : {}),
          ...(payee ? { payee } : {}),
          confidence,
          reason: String(reason ?? ""),
        })),
      };
    },
    ...(config.feedback
      ? {
          async feedback(request: FeedbackRequest) {
            await call("/v1/feedback", request);
          },
        }
      : {}),
  };
}
