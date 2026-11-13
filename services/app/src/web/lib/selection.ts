import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

/** Select mode's state, shared by review and account ledgers: whether selecting, and which
 * items (by ID) are selected. */
export function useSelection() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  return {
    selecting,
    selected,
    has: (id: string) => selected.includes(id),
    toggle: (id: string) =>
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    clear: () => setSelected([]),
    /** Select exactly these: what's shown (a filtered list's rows, not the whole set's). */
    selectAll: (ids: string[]) => setSelected(ids),
    start: () => (setSelecting(true), setSelected([])),
    stop: () => (setSelecting(false), setSelected([])),
  };
}

export type Selection = ReturnType<typeof useSelection>;

/** How long a press is held to start Select mode, as a long press. */
const LONG_PRESS_MS = 500;

/**
 * A long press (holding a finger or the mouse down without moving), for starting Select mode
 * where a tap opens something. The handlers go on the pressed element; `consumed()` says whether
 * the click that follows a long press should be ignored, since it ends the press.
 */
export function useLongPress(onLongPress: (id: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    handlers: (id: string) => ({
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          fired.current = true;
          cancel();
          onLongPress(id);
        }, LONG_PRESS_MS);
      },
      // Scrolling isn't pressing.
      onPointerMove: (e: PointerEvent) => {
        if (
          start.current &&
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10
        )
          cancel();
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // A phone's own long-press menu would cover Select mode.
      onContextMenu: (e: MouseEvent) => {
        if (fired.current || timer.current) e.preventDefault();
      },
    }),
    consumed: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}
