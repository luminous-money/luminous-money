import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

/**
 * Find on the page, for the installed app, which has no browser menu and so no browser find
 * (no page can open the browser's own). It marks what matches with the CSS Custom Highlight API,
 * so the page itself is left untouched, and steps through the matches. A field whose value
 * matches (review's descriptions) is outlined instead, since text in a field can't be marked. A
 * page's own search (review, transactions) is for what isn't shown yet.
 */

const OPEN = "luminous-money:find";

/** Whether this browser can mark matches (Safari 17.2, Chrome 105, Firefox 140 on). */
export const canFind = () => typeof CSS !== "undefined" && "highlights" in CSS;

/** Whether to offer it: in the installed app, where there's no browser find; and on the dev
 * server, to try it. */
export const offerFind = () =>
  canFind() &&
  (import.meta.env.DEV ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true);

/** Open the find bar. */
export const openFind = () => window.dispatchEvent(new Event(OPEN));

/** A match: a piece of text, or a field whose value holds it. */
type Match = Range | HTMLInputElement | HTMLTextAreaElement;

const nodeOf = (m: Match) => (m instanceof Range ? m.startContainer : m);

/** Every visible piece of text and field value under `root` that holds `query`, ignoring case,
 * in the page's order. */
function matches(root: Element, query: string): Match[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || parent.closest(".find-bar, script, style")) return NodeFilter.FILTER_REJECT;
      // Not rendered (folded away, display: none): nothing to show it at.
      if (!parent.getClientRects().length) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const found: Match[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLocaleLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      found.push(range);
    }
  }
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input:not([type]), input[type=text], input[type=search], textarea"
  ))
    if (field.getClientRects().length && field.value.toLocaleLowerCase().includes(needle))
      found.push(field);
  return found.sort((a, b) =>
    nodeOf(a).compareDocumentPosition(nodeOf(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
}

function mark(all: Match[], current: Match | undefined) {
  const ranges = (list: Match[]) => list.filter((m): m is Range => m instanceof Range);
  CSS.highlights.set("find", new Highlight(...ranges(all)));
  CSS.highlights.set("find-current", new Highlight(...ranges(current ? [current] : [])));
  document.querySelectorAll("[data-find]").forEach((f) => f.removeAttribute("data-find"));
  for (const m of all) if (!(m instanceof Range)) m.setAttribute("data-find", "");
  if (current && !(current instanceof Range)) current.setAttribute("data-find", "current");
}

function unmark() {
  CSS.highlights.delete("find");
  CSS.highlights.delete("find-current");
  document.querySelectorAll("[data-find]").forEach((f) => f.removeAttribute("data-find"));
}

const subscribe = (listener: () => void) => {
  window.addEventListener(OPEN, listener);
  return () => window.removeEventListener(OPEN, listener);
};

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Match[]>([]);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [location] = useLocation();

  // Opened from the menu: focus the field (again, if it's open already).
  useEffect(
    () =>
      subscribe(() => {
        setOpen(true);
        window.setTimeout(() => input.current?.select(), 0);
      }),
    []
  );

  // Looked for again whenever what's sought or the page changes.
  const search = (q: string) => {
    const main = document.querySelector("main");
    const all = main ? matches(main, q) : [];
    setFound(all);
    return all;
  };
  useEffect(() => {
    if (!open || !canFind()) return;
    search(query);
    setIndex(0);
  }, [open, query, location]);

  // The current match marked apart from the rest, and scrolled to the middle of the screen.
  useEffect(() => {
    if (!open || !canFind()) return unmark();
    const current = found[index];
    mark(found, current);
    const box = current?.getBoundingClientRect();
    if (box && (box.top < 80 || box.bottom > window.innerHeight - 80))
      window.scrollBy({ top: box.top - window.innerHeight / 2, behavior: "smooth" });
  }, [open, found, index]);

  useEffect(() => () => unmark(), []);

  if (!open) return null;
  const step = (by: number) => {
    // The page may have changed since (loaded more, folded away): look again first.
    const all = search(query);
    if (all.length) setIndex((i) => (Math.min(i, all.length - 1) + by + all.length) % all.length);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="find-bar" role="search" aria-label="Find on page">
      <input
        ref={input}
        type="search"
        aria-label="Find on page"
        placeholder="Find on page"
        value={query}
        enterKeyHint="search"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") close();
        }}
      />
      <span className="find-count small muted" role="status">
        {query ? (found.length ? `${index + 1} of ${found.length}` : "None") : ""}
      </span>
      <button
        type="button"
        className="icon"
        aria-label="Previous match"
        disabled={!found.length}
        onClick={() => step(-1)}
      >
        <ChevronUp aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon"
        aria-label="Next match"
        disabled={!found.length}
        onClick={() => step(1)}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <button type="button" className="icon" aria-label="Close find" onClick={close}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
