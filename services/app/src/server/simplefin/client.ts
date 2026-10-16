/**
 * The SimpleFIN protocol (https://www.simplefin.org/protocol.html), as the SimpleFIN Bridge
 * actually speaks it:
 *
 * - A **setup token** is the base64 of a claim URL. POSTing to it once returns an **access URL**
 *   (`https://user:pass@host/path`); a 403 means it was already claimed.
 * - `GET <access URL>/accounts` returns every account the user connected, with transactions and
 *   (beyond the published spec) `payee`, `memo`, and `holdings` for brokerages.
 * - Errors come as `errlist` (codes like `con.auth`) in the current draft, or as `errors` (plain
 *   strings) in the older shape the Bridge still sends. Both are read.
 *
 * Every URL is checked against the policy (urls.ts) before it's fetched.
 */
import { checkUrl, UrlRefused, type UrlPolicy } from "./urls.js";

export type SfTransaction = {
  id: string;
  /** Unix seconds; 0 while pending. */
  posted: number;
  transacted_at: number | null;
  /** A decimal string; positive is money into the account. */
  amount: string;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
};

export type SfHolding = {
  id: string;
  symbol: string | null;
  description: string | null;
  shares: string;
  cost_basis: string | null;
  market_value: string | null;
  purchase_price: string | null;
  currency: string;
  /** Unix seconds, if given. */
  created: number | null;
};

export type SfAccount = {
  id: string;
  name: string;
  currency: string;
  balance: string;
  available_balance: string | null;
  /** Unix seconds. */
  balance_date: number;
  institution: string;
  transactions: SfTransaction[];
  holdings: SfHolding[];
};

export type SfError = {
  /** `gen.auth`, `con.auth`, `act.failed`, ...; `gen.` for the older plain-string errors. */
  code: string;
  message: string;
  account_id: string | null;
};

export type SfAccountSet = { accounts: SfAccount[]; errors: SfError[] };

export class SimplefinProblem extends Error {
  constructor(
    readonly status: 400 | 403 | 422 | 502,
    message: string
  ) {
    super(message);
  }
}

/** The claim URL inside a setup token. */
export function claimUrlOf(setupToken: string): string {
  const text = Buffer.from(setupToken.trim(), "base64").toString("utf8").trim();
  if (!/^https?:\/\//.test(text))
    throw new SimplefinProblem(422, "that doesn't look like a SimpleFIN setup token");
  return text;
}

const refused = (error: unknown): never => {
  if (error instanceof UrlRefused) throw new SimplefinProblem(422, error.message);
  throw error;
};

/** Trade a setup token for its access URL. Works once. */
export async function claim(
  setupToken: string,
  policy: UrlPolicy,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const url = await checkUrl(claimUrlOf(setupToken), policy).catch(refused);
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-length": "0" },
    // A redirect could lead anywhere, around the host checks: refuse it.
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw new SimplefinProblem(502, "couldn't reach the SimpleFIN server");
  });
  if (response.status === 403)
    throw new SimplefinProblem(
      403,
      "this setup token has already been used. If you didn't use it, someone else may have: disconnect it at SimpleFIN Bridge and make a new one"
    );
  if (!response.ok)
    throw new SimplefinProblem(502, `the SimpleFIN server answered ${response.status}`);
  const access = (await response.text()).trim();
  await checkUrl(access, policy).catch(refused);
  return access;
}

/** Where an access URL points, without its credentials: what the app shows. */
export function hostOf(accessUrl: string): string {
  return new URL(accessUrl).host;
}

const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : v ? Number(v) : null);

function parseAccount(raw: Record<string, unknown>): SfAccount {
  const org = (raw.org ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    currency: String(raw.currency ?? "USD"),
    balance: String(raw.balance ?? "0"),
    available_balance: str(raw["available-balance"]),
    balance_date: Number(raw["balance-date"] ?? 0),
    institution: String(org.name ?? org.domain ?? ""),
    transactions: ((raw.transactions ?? []) as Record<string, unknown>[]).map((t) => ({
      id: String(t.id),
      posted: Number(t.posted ?? 0),
      transacted_at: num(t.transacted_at),
      amount: String(t.amount),
      description: String(t.description ?? ""),
      payee: str(t.payee),
      memo: str(t.memo),
      pending: t.pending === true || Number(t.posted ?? 0) === 0,
    })),
    holdings: ((raw.holdings ?? []) as Record<string, unknown>[]).map((h) => ({
      id: String(h.id),
      symbol: str(h.symbol),
      description: str(h.description),
      shares: String(h.shares ?? "0"),
      cost_basis: str(h.cost_basis),
      market_value: str(h.market_value),
      purchase_price: str(h.purchase_price),
      currency: String(h.currency ?? raw.currency ?? "USD"),
      created: num(h.created),
    })),
  };
}

/** Read an `/accounts` answer, in either shape. */
export function parseAccountSet(body: unknown): SfAccountSet {
  const set = (body ?? {}) as Record<string, unknown>;
  const errlist = (set.errlist ?? []) as Record<string, unknown>[];
  const errors: SfError[] = [
    ...errlist.map((e) => ({
      code: String(e.code ?? "gen."),
      message: String(e.msg ?? e.message ?? ""),
      account_id: str(e.account_id),
    })),
    ...(errlist.length ? [] : ((set.errors ?? []) as unknown[])).map((e) => ({
      code: "gen.",
      message: String(e),
      account_id: null,
    })),
  ];
  return {
    accounts: ((set.accounts ?? []) as Record<string, unknown>[]).map(parseAccount),
    errors,
  };
}

/** Fetch `/accounts`: transactions posted in [start, end] (Unix seconds), never pending. */
export async function fetchAccounts(
  accessUrl: string,
  query: { start?: number; end?: number; account?: string; balancesOnly?: boolean },
  policy: UrlPolicy,
  fetcher: typeof fetch = fetch
): Promise<SfAccountSet> {
  const base = await checkUrl(accessUrl, policy).catch(refused);
  const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}/accounts`);
  if (query.start !== undefined) url.searchParams.set("start-date", String(query.start));
  if (query.end !== undefined) url.searchParams.set("end-date", String(query.end));
  if (query.account) url.searchParams.set("account", query.account);
  if (query.balancesOnly) url.searchParams.set("balances-only", "1");
  const auth = Buffer.from(
    `${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`
  ).toString("base64");
  const response = await fetcher(url, {
    headers: { authorization: `Basic ${auth}` },
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new SimplefinProblem(502, "couldn't reach the SimpleFIN server");
  });
  if (response.status === 403)
    return {
      accounts: [],
      errors: [{ code: "gen.auth", message: "access revoked", account_id: null }],
    };
  if (!response.ok)
    throw new SimplefinProblem(502, `the SimpleFIN server answered ${response.status}`);
  return parseAccountSet(await response.json());
}

/** What an error means for the user, in plain words. */
export function explainError(error: SfError): string {
  if (error.code === "gen.auth")
    return "SimpleFIN no longer accepts this connection: connect it again with a new setup token.";
  if (error.code.startsWith("con.auth"))
    return "Your bank wants you to log in again at SimpleFIN Bridge.";
  if (error.code.startsWith("act."))
    return `An account couldn't be updated${error.message ? `: ${error.message}` : "."}`;
  return error.message || "SimpleFIN reported a problem.";
}
