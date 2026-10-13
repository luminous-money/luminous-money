/**
 * The `rules` categorizer: the user's own rules (src/shared/rules.ts). A matching rule proposes
 * its category and payee with full confidence, so the transaction is settled, and it may
 * confirm the transaction automatically: the only way anything skips review.
 */
import type { CategorizeRequest, IncomingTransaction } from "../../shared/categorizer-api.js";
import { add, isNegative, negate } from "../../shared/decimal.js";
import { payeeKey } from "../../shared/payees.js";
import { specificity, type CategoryRule } from "../../shared/rules.js";
import type { Categorizer } from "./types.js";

/** a ≤ b, for decimal strings. */
const atMost = (a: string, b: string) => !isNegative(add(b, negate(a)));

export function matches(rule: CategoryRule, t: IncomingTransaction): boolean {
  const c = rule.conditions;
  if (specificity(c) === 0) return false;
  if (c.account && c.account !== t.account) return false;
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
    async categorize(request: CategorizeRequest) {
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
            },
          ];
        }),
      };
    },
  };
}
