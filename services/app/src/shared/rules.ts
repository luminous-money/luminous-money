/**
 * Categorization rules: the user's own "if this, then that", per book. Every condition is
 * optional, but a rule needs at least one; a transaction matches when all of its conditions
 * hold. The most specific matching rule wins (more conditions); a tie goes to the newest.
 */

export type RuleConditions = {
  /** The account imported into. */
  account: string | null;
  /** The description's payee key equals this (see payees.ts). */
  key: string | null;
  /** The description contains this text (ignoring case). */
  contains: string | null;
  /** The amount (signed: negative is money out) is at least / at most this. */
  min: string | null;
  max: string | null;
};

export type CategoryRule = {
  id: string;
  book_id: string;
  name: string;
  conditions: RuleConditions;
  /** The category: the account on the other side. */
  account: string;
  /** A clean payee to give, if any. */
  payee: string | null;
  /** Stage matching transactions confirmed, skipping review. */
  auto_confirm: boolean;
  /** How many transactions it has categorized. */
  applied: number;
  created_at: string;
  updated_at: string;
};

export type CategoryRuleIn = Pick<
  CategoryRule,
  "name" | "conditions" | "account" | "payee" | "auto_confirm"
>;

export type CategoryRulePatch = Partial<CategoryRuleIn> & { updated_at: string };

/** How many conditions a rule sets: its specificity. */
export function specificity(c: RuleConditions): number {
  return Object.values(c).filter((v) => v !== null && v !== "").length;
}
