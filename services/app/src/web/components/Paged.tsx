/**
 * Lists paged both ways, as ledgers are (an account's, and the book's journal): newest first,
 * older pages loading as the end scrolls into view, and in a partial view (from a date back)
 * "Load more" above for the newer page before, keeping what's on screen where it was.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** What a list needs of its pages (a TanStack infinite query, either way). */
export type PagedQuery<R> = {
  data?: { pages: { rows: R[] }[] };
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  hasPreviousPage: boolean;
  isFetchingPreviousPage: boolean;
  fetchPreviousPage: () => Promise<unknown>;
};

/**
 * The rows loaded so far, and what to attach: `list` to the list (its rows carry `data-row`),
 * `end` to what follows it (seeing it loads the older page), and `loadNewer` for Load more.
 */
export function usePaging<R extends { id: string }>(pages: PagedQuery<R>) {
  const end = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  const rows = pages.data?.pages.flatMap((page) => page.rows) ?? [];

  // A newer page goes in above: keep what's on screen where it was (where the browser doesn't).
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const rowElement = (id: string) => list.current?.querySelector(`[data-row="${id}"]`);
  const loadNewer = () => {
    const first = rows[0] && rowElement(rows[0].id);
    anchor.current = first ? { id: rows[0]!.id, top: first.getBoundingClientRect().top } : null;
    void pages.fetchPreviousPage();
  };
  useLayoutEffect(() => {
    const kept = anchor.current;
    if (!kept || pages.isFetchingPreviousPage) return;
    anchor.current = null;
    const el = rowElement(kept.id);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - kept.top);
  }, [pages.data, pages.isFetchingPreviousPage]);

  return { rows, list, end, loadNewer };
}

/** The list's top row in a partial view: the newer page is a tap away. Not a row of the list's
 * own, to assistive tech. */
export function NewerRow({ pages, onLoad }: { pages: PagedQuery<unknown>; onLoad: () => void }) {
  if (!pages.hasPreviousPage) return null;
  return (
    <li className="ledger-more" role="none">
      <span className="muted small">Newer transactions above</span>
      <button
        type="button"
        className="plain"
        disabled={pages.isFetchingPreviousPage}
        onClick={onLoad}
      >
        {pages.isFetchingPreviousPage ? "Loading…" : "Load more"}
      </button>
    </li>
  );
}

/** What follows the list: seeing it loads the older page. */
export function MoreBelow({
  pages,
  end,
}: {
  pages: PagedQuery<unknown>;
  end: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={end} className="ledger-end">
      {pages.isFetchingNextPage && <span className="muted">Loading more…</span>}
    </div>
  );
}

/** Go to a date: a partial view, from that date back. Back to newest: the full view. */
export function JumpToDate({ date, onGo }: { date?: string; onGo: (date?: string) => void }) {
  const [value, setValue] = useState(date ?? "");
  return (
    <form
      className="ledger-jump"
      aria-label="Go to a date"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onGo(value);
      }}
    >
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Go to date"
      />
      <button type="submit" disabled={!value || value === date}>
        Go
      </button>
      {date && (
        <p className="small muted">
          From {date} back.{" "}
          <button type="button" className="plain" onClick={() => onGo(undefined)}>
            Back to newest
          </button>
        </p>
      )}
    </form>
  );
}
