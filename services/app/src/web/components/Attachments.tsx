/**
 * A transaction's attachments (M16): each one (an image as a thumbnail, anything else by name)
 * to open or remove, and the camera button to add one: Open camera (grayed out without one) or
 * Upload. A transaction not saved yet holds what's added (`pending`) until it is. With the
 * book's AI set up, a photo or PDF it holds can be read into it as its receipt (Read receipt):
 * its splits become the receipt's, and it's back in review, where this goes.
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";

import { api, type Attachment } from "../lib/ledger.js";
import { withBack } from "../lib/navigation.js";
import {
  explain,
  useAttach,
  useAttachments,
  useDetach,
  useReadReceipt,
  useReceiptsReady,
} from "../lib/queries.js";
import { CameraView, prepared, useHasCamera } from "./Camera.js";

export type Pending = { blob: Blob; name: string };

export function Attachments({
  book,
  transaction,
  canWrite,
  pending,
  onPending,
}: {
  book: string;
  /** The saved transaction, or "" for a new one. */
  transaction: string;
  canWrite: boolean;
  /** A new transaction's files, held until it's saved. */
  pending?: Pending[];
  onPending?: (files: Pending[]) => void;
}) {
  const saved = useAttachments(book, transaction);
  const attach = useAttach(book, transaction);
  const detach = useDetach(book, transaction);
  const readReceipt = useReadReceipt(book, transaction);
  const readable = useReceiptsReady(book) && canWrite && !!transaction;
  const [location, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const read = async (attachment: string) => {
    setError(null);
    try {
      const made = await readReceipt.mutateAsync(attachment);
      navigate(
        withBack(
          `/books/${book}/review?only=${made.transaction_id}${made.ai_cost !== null ? `&ai_cost=${made.ai_cost}` : ""}`,
          location
        )
      );
    } catch (e) {
      setError(explain(e));
    }
  };
  const add = async (file: Pending) => {
    setError(null);
    if (!transaction) return onPending?.([...(pending ?? []), file]);
    try {
      await attach.mutateAsync({ file: file.blob, filename: file.name });
    } catch (e) {
      setError(explain(e));
    }
  };
  // Saved ones and held ones, shown alike.
  const items = transaction
    ? (saved.data ?? []).map((a: Attachment) => ({
        key: a.id,
        name: a.filename,
        image: a.content_type.startsWith("image/"),
        href: api.attachmentUrl(book, a.id),
        remove: () => detach.mutate(a.id),
        read:
          readable && (a.content_type.startsWith("image/") || a.content_type === "application/pdf")
            ? () => void read(a.id)
            : undefined,
      }))
    : (pending ?? []).map((p, i) => ({
        key: String(i),
        name: p.name,
        image: p.blob.type.startsWith("image/"),
        href: URL.createObjectURL(p.blob),
        remove: () => onPending?.((pending ?? []).filter((_, j) => j !== i)),
        read: undefined as (() => void) | undefined,
      }));
  return (
    <section className="attachments" aria-label="Attachments">
      <div className="row-between">
        <h2 className="section-title">Attachments</h2>
        {canWrite && <AddAttachment onFile={(f) => void add(f)} busy={attach.isPending} />}
      </div>
      {items.length === 0 && <p className="small muted">None yet.</p>}
      <ul className="attachment-list">
        {items.map((a) => (
          <li key={a.key} className="attachment">
            <a href={a.href} target="_blank" rel="noreferrer">
              {a.image ? (
                <img src={a.href} alt={a.name} />
              ) : (
                <span className="file-name">{a.name}</span>
              )}
            </a>
            {a.read && (
              <button
                type="button"
                className="plain small"
                aria-label={`Read ${a.name} as its receipt`}
                disabled={readReceipt.isPending}
                onClick={a.read}
              >
                {readReceipt.isPending && readReceipt.variables === a.key
                  ? "Reading…"
                  : "Read receipt"}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                className="plain small"
                aria-label={`Remove ${a.name}`}
                disabled={detach.isPending}
                onClick={a.remove}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {(error ?? detach.error) && <p className="error small">{error ?? explain(detach.error)}</p>}
    </section>
  );
}

/** The camera button: a choice of Open camera (if there is one) or Upload. */
export function AddAttachment({
  onFile,
  busy,
}: {
  onFile: (file: Pending) => void;
  busy?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [shooting, setShooting] = useState(false);
  const hasCamera = useHasCamera();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="icon camera-button"
        aria-label="Add an attachment"
        aria-expanded={choosing}
        disabled={busy}
        onClick={() => setChoosing(!choosing)}
      >
        <CameraIcon />
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/*,.heic,.heif,application/pdf"
        aria-label="Upload a file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(await prepared(file));
        }}
      />
      {choosing && (
        <div className="attach-choices" role="group" aria-label="Attach">
          <button
            type="button"
            disabled={!hasCamera}
            title={hasCamera ? undefined : "No camera on this device"}
            onClick={() => (setChoosing(false), setShooting(true))}
          >
            Open camera
          </button>
          <button type="button" onClick={() => (setChoosing(false), input.current?.click())}>
            Upload
          </button>
        </div>
      )}
      {shooting && (
        <div className="camera-dialog" role="dialog" aria-label="Camera">
          <CameraView
            onShot={(photo) => {
              setShooting(false);
              onFile({ blob: photo, name: `photo-${Date.now()}.jpg` });
            }}
          />
          <button type="button" onClick={() => setShooting(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

export function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
