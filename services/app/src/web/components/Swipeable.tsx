import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { armed, offset, outcome, resolveAxis, type Axis } from "../lib/swipe.js";

type Props = {
  children: ReactNode;
  /** Swipe right. Ignored (the card springs back) while `canConfirm` is false. */
  onConfirm: () => Promise<unknown>;
  /** Swipe left. */
  onSkip: () => unknown;
  canConfirm: boolean;
  /** A right swipe was released on a card that can't be confirmed: point at what's missing. */
  onBlocked?: () => void;
  disabled?: boolean;
};

/** Text fields and an open account picker keep their own gestures. Buttons and links don't:
 * a swipe may start on them, and a drag never counts as a tap. */
const OWN_GESTURES = "input, textarea, select, [role=combobox], [role=listbox]";

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type Drag = {
  id: number;
  x: number;
  y: number;
  axis: Axis;
  dx: number;
  lastX: number;
  lastT: number;
  velocity: number;
};

/**
 * Swipe right to confirm, left to skip. The card follows the finger; releasing past the threshold
 * (or flicking) flies it off and runs the action, and anything less springs back. Position is
 * written straight to the element's style during a drag, so React doesn't re-render per frame.
 */
export function Swipeable({ children, onConfirm, onSkip, canConfirm, onBlocked, disabled }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const mounted = useRef(true);
  const armedNow = useRef(false);
  const [direction, setDirection] = useState<"right" | "left" | null>(null);
  const [isArmed, setArmed] = useState(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const move = (x: number, animate: boolean) => {
    const el = surface.current;
    if (!el) return;
    el.style.transition = animate && !reducedMotion() ? "transform 180ms ease-out" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
  };

  const settle = (x: number) =>
    new Promise<void>((resolve) => {
      move(x, true);
      setTimeout(resolve, reducedMotion() ? 0 : 180);
    });

  const reset = () => {
    drag.current = null;
    armedNow.current = false;
    setDirection(null);
    setArmed(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || (e.target as Element).closest(OWN_GESTURES)) return;
    dragged.current = false;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      axis: null,
      dx: 0,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.axis) {
      d.axis = resolveAxis(dx, e.clientY - d.y);
      if (d.axis === "y") return void (drag.current = null); // a scroll, not a swipe
      if (d.axis === "x") {
        surface.current?.setPointerCapture(e.pointerId);
        dragged.current = true;
      }
    }
    if (d.axis !== "x") return;

    const elapsed = e.timeStamp - d.lastT;
    if (elapsed > 0) d.velocity = (e.clientX - d.lastX) / elapsed;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    d.dx = dx;

    const width = surface.current?.offsetWidth ?? 0;
    move(offset(dx, canConfirm), false);
    setDirection(dx > 0 ? "right" : dx < 0 ? "left" : null);
    const nowArmed = armed(dx, width, canConfirm);
    if (nowArmed !== armedNow.current) {
      armedNow.current = nowArmed;
      setArmed(nowArmed);
      if (nowArmed) navigator.vibrate?.(10);
    }
  };

  const onPointerUp = async (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.axis !== "x") return void (drag.current = null);
    const width = surface.current?.offsetWidth ?? 0;
    const result =
      e.type === "pointercancel" ? "cancel" : outcome(d.dx, d.velocity, width, canConfirm);
    drag.current = null;

    if (result === "cancel") {
      if (d.dx > 0 && !canConfirm) onBlocked?.();
      await settle(0);
    } else {
      await settle(result === "confirm" ? width * 1.1 : -width * 1.1);
      await (result === "confirm" ? onConfirm() : onSkip());
      // Confirmed cards leave the queue and unmount. A skipped card, or one whose save failed,
      // is still here: put it back in place.
      if (mounted.current) move(0, false);
    }
    if (mounted.current) reset();
  };

  // A blocked card only moves a few pixels, so its underlay is a color, not a label.
  const label =
    direction === "right" ? (canConfirm ? "Confirm" : "") : direction === "left" ? "Skip" : "";

  return (
    <div className="swipe">
      <div
        aria-hidden
        className={`swipe-under ${direction ?? ""} ${direction === "right" && !canConfirm ? "blocked" : ""} ${isArmed ? "armed" : ""}`}
      >
        <span>{label}</span>
      </div>
      <div
        ref={surface}
        className="swipe-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Links and images would otherwise start a native drag, which cancels the swipe.
        onDragStart={(e) => e.preventDefault()}
        // A drag that started on a button or link must not also click it.
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
