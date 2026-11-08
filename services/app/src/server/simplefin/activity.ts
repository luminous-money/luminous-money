/**
 * Reading a brokerage's rows (the brokerage activity plan). A brokerage's rows over SimpleFIN
 * are all cash, each saying in words what it was, so a reader per institution turns each into
 * what it is before it's staged:
 *
 * - **sweep:** into or out of the core money market, which the books count as cash: nothing
 * - **dividend:** income, confirmed by itself (only the exact words; nothing that merely looks
 *   like income)
 * - **buy, sell:** a trade of the symbol named
 * - **shares-in:** shares received from another broker (a transfer of assets), not cash
 * - **cash-in:** cash received from another broker with a transfer of assets
 * - **other:** anything else (transfers, deposits, what's never been seen): the usual pipeline
 *
 * Only institutions with a reader are read; another brokerage's rows come in as cash, as before.
 */
import type { SfHolding } from "./client.js";

export type ActivityKind =
  "sweep" | "dividend" | "buy" | "sell" | "shares-in" | "cash-in" | "other";

export type Activity = {
  kind: ActivityKind;
  /** The security the row names: its symbol, or a CUSIP for one without a ticker. */
  security: string | null;
};

/** A reader of one institution's rows. */
export type Reader = {
  /** Who it reads: the institution's name, as SimpleFIN gives it. */
  institution: RegExp;
  name: string;
  read(description: string, cashLike: (security: string) => boolean): Activity;
};

/** The security a row names: the last parenthesized symbol, leaving out the account type
 * Fidelity adds ("(Cash)", "(Margin)"). */
function securityIn(text: string): string | null {
  const groups = [...text.matchAll(/\(([A-Z0-9.]{1,12})\)/g)].map((m) => m[1]!);
  const named = groups.filter((g) => !/^(CASH|MARGIN|SHORT)$/i.test(g));
  return named.at(-1) ?? null;
}

/** A CUSIP (nine characters, a digit among them), for a security without a ticker. */
const CUSIP = /\b([0-9][0-9A-Z]{8})\b/;

export const fidelity: Reader = {
  institution: /^fidelity investments$/i,
  name: "Fidelity",
  read(description, cashLike) {
    const text = description.trim().toUpperCase();
    const security = securityIn(text);
    const is = (kind: ActivityKind, named = security): Activity => ({ kind, security: named });
    if (/^(PURCHASE INTO|REDEMPTION FROM) CORE ACCOUNT\b/.test(text))
      return security && cashLike(security) ? is("sweep") : is("other");
    if (/^REINVESTMENT\b/.test(text)) {
      if (!security) return is("other");
      // Into the core: a dividend swept in. Into anything else: a buy with the dividend.
      return cashLike(security) ? is("sweep") : is("buy");
    }
    if (/^DIVIDEND RECEIVED\b/.test(text) && security) return is("dividend");
    if (/^YOU BOUGHT\b/.test(text) && security && !cashLike(security)) return is("buy");
    if (/^YOU SOLD\b/.test(text) && security && !cashLike(security)) return is("sell");
    if (/^TRANSFER OF ASSETS ACAT RES\.CREDIT\b/.test(text)) return is("cash-in", null);
    if (/^TRANSFER OF ASSETS ACAT RECEIVE\b/.test(text)) {
      const named = security ?? text.replace(/\(CASH\)/g, "").match(CUSIP)?.[1] ?? null;
      if (!named) return is("cash-in", null);
      return cashLike(named) ? is("cash-in", null) : is("shares-in", named);
    }
    return is("other", null);
  },
};

export const READERS: Reader[] = [fidelity];

/** The reader for an institution's rows, if there is one. */
export const readerFor = (institution: string | null | undefined): Reader | undefined =>
  READERS.find((r) => r.institution.test((institution ?? "").trim()));

/** Money-market funds a brokerage uses as its core position: cash in all but name, even with
 * no shares (and so no price) in the snapshot. */
const CORE_FUNDS = new Set(["SPAXX", "FDRXX", "FZFXX", "SPRXX", "FCASH", "CORE"]);

export const isCoreFund = (symbol: string) => CORE_FUNDS.has(symbol.trim().toUpperCase());

/** Whether the security a row names is cash-like in this snapshot: a holding priced at 1, or a
 * known core fund. */
export function cashLikeIn(holdings: SfHolding[]) {
  return (security: string) => {
    if (isCoreFund(security)) return true;
    const h = holdings.find((x) => x.symbol?.trim().toUpperCase() === security);
    if (!h) return false;
    const shares = Number(h.shares);
    const value = Number(h.market_value);
    return !!shares && Math.abs(value / shares - 1) < 1e-9;
  };
}

/** Whether a link's account is a retirement account, by the bank's name for it or the book's:
 * its dividends aren't taxable, so they go elsewhere by default. */
export const isRetirement = (...names: (string | null | undefined)[]) =>
  names.some((n) =>
    /\b(IRA|ROTH|401\s?K|403\s?B|457|HSA|RETIREMENT|PENSION)\b/i.test(
      (n ?? "").replace(/[:_-]/g, " ")
    )
  );

export const DIVIDENDS = "Income:Dividends";
export const RETIREMENT_DIVIDENDS = "Income:Retirement:Dividends";
