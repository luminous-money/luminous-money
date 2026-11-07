/**
 * Coming back to the same place in a list after opening one of its items (review's cards, where
 * Back or Confirm on the transaction's page returns): the item opened, where it was on screen,
 * and the items after and before it, kept for the browser's session. On return the item (or, if
 * it's gone, the next one still there) is put back where it was, and kept there while the page
 * settles, until it's scrolled by hand.
 */
import { useLayoutEffect } from "react";

type Place = { ids: string[]; top: number };

const keyOf = (list: string) => `place:${list}`;

/** An element of the list stands for item `id` with `data-place={id}`. */
const elementOf = (id: string) => document.querySelector(`[data-place="${CSS.escape(id)}"]`);

/** Remember item `id` (its element on screen now), with the ids after it and before it in the
 * list, nearest first, to stand in for it if it's gone on return. */
export function rememberPlace(list: string, id: string, after: string[], before: string[]) {
  const element = elementOf(id);
  if (!element) return;
  const place: Place = {
    ids: [id, ...after.slice(0, 50), ...before.slice(0, 10)],
    top: element.getBoundingClientRect().top,
  };
  sessionStorage.setItem(keyOf(list), JSON.stringify(place));
}

function takePlace(list: string): Place | null {
  const text = sessionStorage.getItem(keyOf(list));
  sessionStorage.removeItem(keyOf(list));
  try {
    return text ? (JSON.parse(text) as Place) : null;
  } catch {
    return null;
  }
}

/** How long the place is kept while what's above it loads (cards growing, a refetch). */
const SETTLE_MS = 1500;

/** Once the list's `ids` are shown, scroll back to the place remembered for `list`, if any. */
export function useReturnToPlace(list: string, ids: string[] | undefined) {
  const ready = ids !== undefined;
  useLayoutEffect(() => {
    if (!ready) return;
    const place = takePlace(list);
    if (!place) return;
    let pinned: Element | null = null;
    const pin = () => {
      if (!pinned?.isConnected) {
        const id = place.ids.find((x) => elementOf(x));
        pinned = id ? elementOf(id) : null;
      }
      if (pinned)
        window.scrollTo(0, window.scrollY + pinned.getBoundingClientRect().top - place.top);
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(document.body);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const event of HAND) window.removeEventListener(event, stop);
    };
    const timer = setTimeout(stop, SETTLE_MS);
    for (const event of HAND) window.addEventListener(event, stop, { passive: true });
    return stop;
  }, [list, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Scrolling by hand ends the settling. */
const HAND = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
