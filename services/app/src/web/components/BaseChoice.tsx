/**
 * A receipt that didn't say what paid it (M16) is on `Assets:Unknown` until someone chooses:
 * "Paid from" (or "Into", for a refund) the account it really came from. A divided account takes
 * it in its main part, as imports do. Until then it can't be confirmed.
 */
import { baseAccounts, UNKNOWN } from "../../shared/accounts.js";
import { landsIn } from "../../shared/divided.js";
import { isNegative } from "../lib/decimal.js";
import { useAccounts } from "../lib/queries.js";
import { AccountPicker } from "./AccountPicker.js";

type Posting = { account: string; units?: { number: string; currency: string } | null };

export function BaseChoice<P extends Posting>({
  book,
  postings,
  onChange,
}: {
  book: string;
  postings: P[];
  /** The postings, the unknown one moved to the account chosen. */
  onChange: (postings: P[]) => void;
}) {
  const accounts = useAccounts(book).data ?? [];
  const index = postings.findIndex((p) => p.account === UNKNOWN);
  if (index < 0) return null;
  const posting = postings[index]!;
  const out = posting.units ? isNegative(posting.units.number) : true;
  return (
    <div className="category needs">
      <AccountPicker
        label={out ? "Paid from" : "Into"}
        accounts={baseAccounts(accounts)}
        value=""
        prefer={["Liabilities", "Assets"]}
        onChange={(chosen) => {
          const account = landsIn(accounts, chosen) ?? chosen;
          onChange(postings.map((p, i) => (i === index ? { ...p, account } : p)));
        }}
      />
    </div>
  );
}
