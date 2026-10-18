/**
 * A transaction in a divided account (M15): which part it's in, as a choice ("Paid from:
 * General ▾"). Moving it to another part is just changing that posting's account, so nothing
 * else about it changes, and the whole's balance doesn't move.
 */
import { partOf } from "../../shared/divided.js";
import { displayName } from "../lib/accounts.js";
import { isNegative } from "../lib/decimal.js";
import { useAccounts } from "../lib/queries.js";

type Posting = { account: string; units?: { number: string; currency: string } | null };

export function PartChoice<P extends Posting>({
  book,
  postings,
  disabled,
  onChange,
}: {
  book: string;
  postings: P[];
  disabled?: boolean;
  /** The postings, the part's one moved. */
  onChange: (postings: P[]) => void;
}) {
  const accounts = useAccounts(book).data ?? [];
  const index = postings.findIndex((p) => partOf(accounts, p.account));
  if (index < 0) return null;
  const posting = postings[index]!;
  const whole = partOf(accounts, posting.account)!;
  const parts = accounts.filter(
    (a) => a.name.startsWith(`${whole}:`) && a.kind === "leaf" && !a.implicit && !a.close
  );
  const out = posting.units ? isNegative(posting.units.number) : true;
  const label = out ? "Paid from" : "Into";
  return (
    <label className="part-choice small">
      {label}{" "}
      <select
        aria-label={label}
        value={posting.account}
        disabled={disabled}
        onChange={(e) =>
          onChange(postings.map((p, i) => (i === index ? { ...p, account: e.target.value } : p)))
        }
      >
        {parts.map((p) => (
          <option key={p.name} value={p.name}>
            {displayName(p)}
          </option>
        ))}
      </select>
    </label>
  );
}
