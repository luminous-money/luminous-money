/**
 * The math behind swiping queue cards: which way a drag is going, how far the card follows, and
 * what releasing it does. Kept pure so it's testable without a browser.
 */

/** Movement (px) before a drag commits to an axis. Vertical drags are left to scrolling. */
export const AXIS_SLOP = 8;
/** How far right a card that can't be confirmed will follow before it stops. */
export const BLOCKED_MAX = 48;
/** A flick this fast (px/ms) commits even when it's short... */
export const FLICK_SPEED = 0.6;
/** ...as long as it travelled at least this far. */
export const FLICK_MIN = 40;

export type Axis = "x" | "y" | null;
export type Outcome = "confirm" | "skip" | "cancel";

export function resolveAxis(dx: number, dy: number): Axis {
  if (Math.hypot(dx, dy) < AXIS_SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** Where the card is drawn for a drag of `dx`: it follows the finger, except that a right drag
 * on a card that can't be confirmed meets resistance and stops short. */
export function offset(dx: number, canConfirm: boolean): number {
  if (dx > 0 && !canConfirm) return Math.min(BLOCKED_MAX, dx * 0.25);
  return dx;
}

/** Distance past which releasing commits. */
export function threshold(width: number): number {
  return Math.min(width * 0.35, 140);
}

export function armed(dx: number, width: number, canConfirm: boolean): boolean {
  return Math.abs(dx) >= threshold(width) && (dx < 0 || canConfirm);
}

/** What releasing a drag does. `velocity` is px/ms, signed like `dx`. */
export function outcome(dx: number, velocity: number, width: number, canConfirm: boolean): Outcome {
  const far = Math.abs(dx) >= threshold(width);
  const flick =
    Math.abs(velocity) >= FLICK_SPEED &&
    Math.abs(dx) >= FLICK_MIN &&
    Math.sign(velocity) === Math.sign(dx);
  if (!far && !flick) return "cancel";
  if (dx < 0) return "skip";
  return canConfirm ? "confirm" : "cancel";
}
