import { Info as InfoIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const WIDTH = 288;
const MARGIN = 12;

/**
 * An (i) that tells more when tapped: what a page or a setting is about, kept off the page
 * until asked for. The note opens under the (i), kept on screen, and closes on a tap elsewhere,
 * Escape, or scrolling.
 */
export function Info({ label, children }: { label: string; children: ReactNode }) {
  const button = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const outside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!note.current?.contains(target) && !button.current?.contains(target)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  const toggle = () => {
    if (at || !button.current) return setAt(null);
    const r = button.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.min(
      Math.max(r.left + r.width / 2 - width / 2, MARGIN),
      window.innerWidth - width - MARGIN
    );
    setAt({ top: r.bottom + 6, left, width });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="info-button"
        aria-label={label}
        aria-expanded={!!at}
        onClick={toggle}
      >
        <InfoIcon aria-hidden="true" />
      </button>
      {at &&
        createPortal(
          <div
            ref={note}
            className="info-note"
            role="note"
            aria-label={label}
            style={{ top: at.top, left: at.left, width: at.width }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
