import type { Transaction } from "@fava-beans/ledger-client";

import { shortName } from "../lib/accounts.js";
import { formatMoney } from "../lib/decimal.js";
import { explain, useRejectTransfer, useTransfers } from "../lib/queries.js";

/**
 * A transfer paired from two imports (money out of one account, the same into another): what
 * it was made of, and "Reject" to have the two back in its place if it isn't one transfer.
 * Shown while it's unconfirmed; confirming it settles it.
 */
export function PairedTransfer({
  book,
  transaction,
  onRejected,
}: {
  book: string;
  transaction: Transaction;
  onRejected?: () => void;
}) {
  const transfers = useTransfers(book);
  const reject = useRejectTransfer(book);
  const pair = transfers.data?.find((p) => p.transaction_id === transaction.id);
  if (!pair || transaction.flag !== "!") return null;
  return (
    <div className="paired-transfer small" role="note" aria-label="Paired transfer">
      <p>
        <span className="pill">Transfer</span> Paired from two imports:
      </p>
      <ul>
        {pair.originals.map((o) => (
          <li key={`${o.account}:${o.date}`}>
            <span className="num">
              {o.amount ? formatMoney(o.amount.number, o.amount.currency) : "?"}
            </span>{" "}
            {shortName(o.account)} · {o.date} · <span className="muted">{o.description}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        Not one transfer?{" "}
        <button
          type="button"
          className="plain"
          disabled={reject.isPending}
          onClick={() => reject.mutate(transaction.id, { onSuccess: onRejected })}
        >
          Reject
        </button>{" "}
        and have the two back.
      </p>
      {reject.error && <p className="error">{explain(reject.error)}</p>}
    </div>
  );
}
