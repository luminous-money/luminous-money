import { MoreHorizontal } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { usePopover } from "../lib/popover.js";

/**
 * "⋯": the actions a page doesn't need in view (Repeat…, Delete), folded away. A disclosure, not
 * an ARIA menu: its items stay the links and buttons they are (`.menu-item`), reached by Tab;
 * choosing one closes it.
 */
export function Overflow({
  label = "More actions",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const { open, setOpen, ref } = usePopover();
  const button = useRef<HTMLButtonElement>(null);
  // Toward the page's middle: from its left edge in the left half, else from its right.
  const [side, setSide] = useState<"left" | "right">("right");
  const toggle = () => {
    const box = button.current?.getBoundingClientRect();
    if (box) setSide(box.left + box.width / 2 < window.innerWidth / 2 ? "left" : "right");
    setOpen((o) => !o);
  };
  return (
    <div className="menu overflow" ref={ref}>
      <button
        ref={button}
        type="button"
        className="icon"
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`menu-panel from-${side}`}
          role="group"
          aria-label={label}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
