/**
 * The masthead's camera (M16): capture a receipt into the book, shown only when receipts can
 * be read (the ai service up, the book's AI ready, and you can change the book). On an asset or
 * liability account's page, that account is the receipt's base account; wherever you are is
 * where you come back to.
 */
import { Link, useLocation } from "wouter";

import { withBack } from "../lib/navigation.js";
import { useAccounts, useReceiptsReady } from "../lib/queries.js";
import { CameraIcon } from "./Attachments.js";

export function ReceiptButton({ book }: { book: string }) {
  const ready = useReceiptsReady(book);
  const [location] = useLocation();
  const accounts = useAccounts(book);
  if (!ready || location.startsWith(`/books/${book}/receipt`)) return null;
  const on = /^\/books\/[^/]+\/accounts\/([^/?]+)$/.exec(location)?.[1];
  const account = on && decodeURIComponent(on);
  const type = accounts.data?.find((a) => a.name === account)?.type;
  const hint =
    account && (type === "asset" || type === "liability")
      ? `?account=${encodeURIComponent(account)}`
      : "";
  return (
    <Link
      href={withBack(`/books/${book}/receipt${hint}`, location)}
      className="icon receipt-button"
      aria-label="Capture a receipt"
      title="Capture a receipt"
    >
      <CameraIcon />
    </Link>
  );
}
