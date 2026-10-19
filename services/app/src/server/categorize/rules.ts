/**
 * The `rules` categorizer: the user's own rules (src/shared/rules.ts). A matching rule proposes
 * its category and payee with full confidence, so a bank row is settled (a receipt with several
 * splits takes it as the fallback), and it may confirm the transaction automatically: the only
 * way anything skips review.
 */
import type { IncomingTransaction } from "../../shared/categorizer-api.js";
import { add, isNegative, negate } from "../../shared/decimal.js";
import { payeeKey } from "../../shared/payees.js";
import { specificity, type CategoryRule, type CategoryRuleIn } from "../../shared/rules.js";
import type { Account } from "@fava-beans/ledger-client";
import type { Categorizer, Request } from "./types.js";

/** a ≤ b, for decimal strings. */
const atMost = (a: string, b: string) => !isNegative(add(b, negate(a)));

export function matches(rule: CategoryRule, t: IncomingTransaction): boolean {
  const c = rule.conditions;
  if (specificity(c) === 0) return false;
  // An account, or (a divided account) any of its parts.
  if (c.account && c.account !== t.account && !t.account.startsWith(`${c.account}:`)) return false;
  if (c.key && c.key !== payeeKey(t.description)) return false;
  if (c.contains && !t.description.toLowerCase().includes(c.contains.toLowerCase())) return false;
  if (c.min && !atMost(c.min, t.amount.number)) return false;
  if (c.max && !atMost(t.amount.number, c.max)) return false;
  return true;
}

/** The rule that applies to `t`, if any: the most specific match, the newest on a tie. */
export function ruleFor(rules: CategoryRule[], t: IncomingTransaction): CategoryRule | undefined {
  return rules
    .filter((r) => matches(r, t))
    .sort(
      (a, b) =>
        specificity(b.conditions) - specificity(a.conditions) ||
        b.created_at.localeCompare(a.created_at)
    )[0];
}

export function rules(load: (book: string) => CategoryRule[]): Categorizer {
  return {
    name: "rules",
    async categorize(request: Request) {
      const all = load(request.book.id);
      return {
        proposals: request.transactions.flatMap((t) => {
          const rule = ruleFor(all, t);
          if (!rule) return [];
          return [
            {
              id: t.id,
              postings: [{ account: rule.account }],
              ...(rule.payee ? { payee: rule.payee } : {}),
              confidence: 1,
              reason: `Rule "${rule.name}"`,
              auto_confirm: rule.auto_confirm,
              rule_id: rule.id,
              ...(rule.part ? { part: rule.part } : {}),
            },
          ];
        }),
      };
    },
  };
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Why a rule can't be saved, or null if it can. */
export function ruleProblem(rule: CategoryRuleIn | null, accounts: Account[]): string | null {
  if (!rule?.name?.trim()) return "Name the rule";
  const c = rule.conditions;
  if (!c || specificity(c) === 0) return "Give the rule at least one condition";
  for (const bound of [c.min, c.max])
    if (bound && !DECIMAL.test(bound)) return "Amounts are numbers, like -25.00";
  const leaves = new Set(
    accounts.filter((a) => a.kind === "leaf" && !a.implicit && !a.close).map((a) => a.name)
  );
  const divided = new Set(accounts.filter((a) => a.divided && !a.close).map((a) => a.name));
  if (!leaves.has(rule.account)) return `${rule.account || "The category"} isn't an open account`;
  if (c.account && !leaves.has(c.account) && !divided.has(c.account))
    return `${c.account} isn't an open account`;
  if (rule.part) {
    if (!c.account || !divided.has(c.account))
      return "Only transactions imported into a divided account land in a part";
    if (!leaves.has(rule.part) || !rule.part.startsWith(`${c.account}:`))
      return `${rule.part} isn't one of ${c.account}'s parts`;
  }
  return null;
}
