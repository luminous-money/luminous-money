/** What reading a receipt said (M16), on its transaction: why it wasn't read, or wasn't
 * categorized, or what the reader noticed ("the tip is handwritten"). */
export function ReceiptNote({ meta }: { meta: Record<string, unknown> | null | undefined }) {
  const note = meta?.["receipt-note"];
  if (typeof note !== "string" || !note) return null;
  return (
    <p className="small muted receipt-note" aria-label="About the receipt">
      Receipt: {note}
    </p>
  );
}

/** What reading a brokerage's row said about the trade it booked (the brokerage activity plan):
 * that its shares are estimated, fitted to today's, or from the bank's holdings. */
export function BrokerageNote({ meta }: { meta: Record<string, unknown> | null | undefined }) {
  const note = meta?.["brokerage-note"];
  if (typeof note !== "string" || !note) return null;
  return (
    <p className="small muted receipt-note" aria-label="About the shares">
      {note}
    </p>
  );
}
