/**
 * Categorization rules: the user's own "if this, then that", per book. Every condition is
 * optional, but a rule needs at least one; a transaction matches when all of its conditions
 * hold. The most specific matching rule wins (more conditions); a tie goes to the newest.
 */

export type RuleConditions = {
  /** The account imported into (a divided account: any of its parts). */
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
  /** For transactions imported into a divided account (M15): the part their own side lands in,
   * instead of its main part ("Interest, lands in Padding"). One of `conditions.account`'s. */
  part: string | null;
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
> & { part?: string | null };

export type CategoryRulePatch = Partial<CategoryRuleIn> & { updated_at: string };

/** How many conditions a rule sets: its specificity. */
export function specificity(c: RuleConditions): number {
  return Object.values(c).filter((v) => v !== null && v !== "").length;
}
