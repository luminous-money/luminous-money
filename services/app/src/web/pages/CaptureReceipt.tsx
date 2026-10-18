/**
 * Capture receipt (M16): the top half is the live camera, or once taken the photo (or the file
 * uploaded), with ↺ to take another; the bottom is a drawer (its handle opens and closes it) with
 * "Upload instead", the base account (the account you came from, if it's an asset or
 * liability), "Itemize receipt?" (the book's default), and optional hints. Creating it sends the
 * lot to `app`, which has the ai service read it and stages it; then it's in review, and
 * confirming or skipping it comes back here, to where you started.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { CameraView, prepared, useHasCamera } from "../components/Camera.js";
import { baseAccounts } from "../../shared/accounts.js";
import { displayName } from "../lib/accounts.js";
import { isDecimal, negate } from "../lib/decimal.js";
import { useBack, useParam, withBack } from "../lib/navigation.js";
import { explain, useAccounts, useAiSettings, useCaptureReceipt } from "../lib/queries.js";

export function CaptureReceipt({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const back = useBack(`/books/${book}`);
  const preset = useParam("account");
  const accounts = useAccounts(book);
  const settings = useAiSettings(book);
  const capture = useCaptureReceipt(book);
  const hasCamera = useHasCamera();
  const input = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<{ blob: Blob; name: string } | null>(null);
  const [drawer, setDrawer] = useState(true);
  const [account, setAccount] = useState("");
  const [itemize, setItemize] = useState<boolean | null>(null);
  const [total, setTotal] = useState("");
  const [refund, setRefund] = useState(false);
  const [date, setDate] = useState("");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");

  const chart = accounts.data ?? [];
  const bases = useMemo(() => baseAccounts(chart), [chart]);
  useEffect(() => {
    if (preset && bases.includes(preset)) setAccount(preset);
  }, [preset, bases]);
  const itemized = itemize ?? settings.data?.itemize ?? false;
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo.blob) : null), [photo]);
  const typed = total.replace(/[$,\s]/g, "");
  const totalOk = !typed || (isDecimal(typed) && !typed.startsWith("-"));

  const submit = async () => {
    if (!photo) return;
    try {
      // Typed as spent (or refunded); stored as it moves the base account: a purchase takes
      // money out of a bank account, and adds to what's owed on a card, negative either way.
      const stored = typed ? (refund ? typed : negate(typed)) : null;
      const made = await capture.mutateAsync({
        file: photo.blob,
        filename: photo.name,
        hints: {
          account: account || null,
          itemize: itemized ? "yes" : "no",
          total: stored,
          date: date || null,
          payee: payee.trim() || null,
          note: note.trim() || null,
        },
      });
      navigate(withBack(`/books/${book}/review?only=${made.transaction_id}`, back));
    } catch {
      // shown from the mutation's error
    }
  };

  return (
    <main className="capture">
      <div className="capture-view">
        {preview ? (
          <>
            {photo!.blob.type === "application/pdf" ? (
              <p className="capture-file">{photo!.name}</p>
            ) : (
              <img src={preview} alt="The receipt" />
            )}
            <button
              type="button"
              className="icon retake"
              aria-label="Take another"
              onClick={() => setPhoto(null)}
            >
              ↺
            </button>
          </>
        ) : hasCamera ? (
          <CameraView onShot={(blob) => setPhoto({ blob, name: `receipt-${Date.now()}.jpg` })} />
        ) : (
          <p className="capture-file small">
            {hasCamera === null
              ? "Looking for a camera…"
              : "No camera here: upload the receipt instead."}
          </p>
        )}
      </div>

      <section className={`drawer${drawer ? " open" : ""}`} aria-label="Receipt">
        <button
          type="button"
          className="drawer-handle"
          aria-label={drawer ? "Close the form" : "Open the form"}
          aria-expanded={drawer}
          onClick={() => setDrawer(!drawer)}
        >
          <span aria-hidden="true" />
        </button>
        {drawer && (
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="row-between">
              <Link href={back} className="small">
                ‹ Back
              </Link>
              <button type="button" className="plain" onClick={() => input.current?.click()}>
                Upload instead
              </button>
              <input
                ref={input}
                type="file"
                hidden
                accept="image/*,application/pdf"
                aria-label="Upload a receipt"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setPhoto(await prepared(file));
                }}
              />
            </div>
            <AccountPicker
              label="Paid from"
              accounts={bases}
              value={account}
              onChange={setAccount}
            />
            <span className="small muted">
              {account
                ? `A hint: the receipt may say otherwise (${displayName(chart.find((a) => a.name === account) ?? { name: account })}).`
                : "Optional: the AI works it out from the receipt."}
            </span>
            <fieldset className="check-row">
              <legend>Itemize receipt?</legend>
              <div className="segmented" role="radiogroup" aria-label="Itemize receipt?">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={itemized === v}
                    className={itemized === v ? "on" : ""}
                    onClick={() => setItemize(v)}
                  >
                    {v ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </fieldset>
            <details className="receipt-hints">
              <summary>Add what you know</summary>
              <label>
                Total
                <input
                  inputMode="decimal"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  placeholder="0.00"
                  aria-label="Total"
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={refund}
                  onChange={(e) => setRefund(e.target.checked)}
                />
                It's a refund
              </label>
              <label>
                Date
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                Payee
                <input
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  aria-label="Payee"
                />
              </label>
              <label>
                Note
                <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              </label>
            </details>
            {!totalOk && <p className="small error">The total is an amount, like 12.34.</p>}
            {settings.data && !settings.data.ready && (
              <p className="small muted">
                The book's AI isn't set up, so this is made from what you type.{" "}
                <Link href={`/books/${book}/ai`}>Set it up</Link>
              </p>
            )}
            {capture.error && <p className="error">{explain(capture.error)}</p>}
            <div className="actions">
              <button
                type="submit"
                className="primary"
                disabled={!photo || !totalOk || capture.isPending}
              >
                {capture.isPending ? "Reading it…" : "Create transaction"}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
