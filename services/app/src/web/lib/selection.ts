import { useState } from "react";

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
