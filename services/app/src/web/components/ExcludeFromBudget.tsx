import type { Transaction } from "@fava-beans/ledger-client";

type Meta = NonNullable<Transaction["meta"]>;

/** The ledger's `budget: FALSE` (M11): the transaction counts everywhere but against budgets. */
export const excludedFromBudget = (meta: Meta | undefined) => meta?.budget === false;

/**
 * "Exclude from budget": for the rare expense (a roof, once in twenty years) or income that
 * shouldn't count against a budget, though it's categorized and counts everywhere else. Hands
 * back the transaction's whole metadata, changed, since an edit replaces it.
 */
export function ExcludeFromBudget({
  meta,
  disabled,
  onChange,
}: {
  meta: Meta | undefined;
  disabled?: boolean;
  onChange: (meta: Meta) => void;
}) {
  return (
    <label className="check small exclude-budget">
      <input
        type="checkbox"
        checked={excludedFromBudget(meta)}
        disabled={disabled}
        onChange={(e) => {
          const { budget: _, ...rest } = meta ?? {};
          onChange(e.target.checked ? { ...rest, budget: false } : rest);
        }}
      />
      Exclude from budget
    </label>
  );
}
