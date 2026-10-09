import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import { armed, offset, outcome, resolveAxis, type Axis } from "../lib/swipe.js";

export type SwipeAction = "confirm" | "skip";

/** Lets the card's buttons run the same animated confirm or skip as a swipe. */
export type SwipeHandle = { commit: (action: SwipeAction) => Promise<void> };

type Props = {
  children: ReactNode;
  handle?: Ref<SwipeHandle>;
  /** Swipe right. Resolves true once saved; false (or a throw) puts the card back. */
  onConfirm: () => Promise<boolean>;
  /** Swipe left. */
  onSkip: () => unknown;
  /** Ignored right swipes spring back while this is false. */
  canConfirm: boolean;
  /** A right swipe was released on a card that can't be confirmed: point at what's missing. */
  onBlocked?: () => void;
  disabled?: boolean;
};

const FLY_MS = 180;
const COLLAPSE_MS = 220;

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms));

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
 * (or flicking) commits, and anything less springs back. Position is written straight to the
 * element's style during a drag, so React doesn't re-render per frame.
 *
 * Committing, by swipe or by button, flies the card off and collapses the space it leaves, so the
 * cards below slide up; then the action runs. If the card is still here afterwards (it was
 * skipped to the end, or its save failed), it comes back in place.
 *
 * A swipe may start anywhere on the card, including on fields, buttons and links: wherever a
 * thumb lands. A drag never counts as a tap, and text selection is suspended while dragging.
 */
export function Swipeable({
  children,
  handle,
  onConfirm,
  onSkip,
  canConfirm,
  onBlocked,
  disabled,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
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
    el.style.transition = animate && !reducedMotion() ? `transform ${FLY_MS}ms ease-out` : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
  };

  /** Shrink the card's slot to nothing, so the cards below slide up into it. */
  const collapse = async () => {
    const el = root.current;
    if (!el) return;
    el.style.height = `${el.offsetHeight}px`;
    void el.offsetHeight; // commit the starting height before animating from it
    el.style.transition = reducedMotion()
      ? "none"
      : `height ${COLLAPSE_MS}ms ease-in-out, margin ${COLLAPSE_MS}ms ease-in-out, opacity ${COLLAPSE_MS}ms`;
    el.style.height = "0px";
    el.style.marginBottom = "0px";
    el.style.opacity = "0";
    await pause(COLLAPSE_MS);
  };

  /** Back in place, as if nothing happened. */
  const restore = () => {
    const el = root.current;
    if (el)
      for (const prop of ["transition", "height", "marginBottom", "opacity"] as const)
        el.style[prop] = "";
    move(0, false);
  };

  const reset = () => {
    drag.current = null;
    armedNow.current = false;
    surface.current?.classList.remove("dragging");
    setDirection(null);
    setArmed(false);
  };

  const commit = async (action: SwipeAction) => {
    const width = surface.current?.offsetWidth ?? 0;
    setDirection(action === "confirm" ? "right" : "left");
    move(action === "confirm" ? width * 1.1 : -width * 1.1, true);
    await pause(FLY_MS);
    await collapse();
    try {
      if (action === "confirm") await onConfirm();
      else await onSkip();
    } finally {
      // Confirmed cards leave the queue and unmount. Anything still here comes back.
      if (mounted.current) {
        restore();
        reset();
      }
    }
  };

  useImperativeHandle(handle, () => ({ commit }));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
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
        surface.current?.classList.add("dragging");
        // A drag that began in a text field would otherwise be selecting its text.
        window.getSelection()?.removeAllRanges();
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
      move(0, true);
      await pause(FLY_MS);
      if (mounted.current) reset();
    } else {
      await commit(result);
    }
  };

  // A blocked card only moves a few pixels, so its underlay is a color, not a label.
  const label =
    direction === "right" ? (canConfirm ? "Confirm" : "") : direction === "left" ? "Skip" : "";

  return (
    <div className="swipe" ref={root}>
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
