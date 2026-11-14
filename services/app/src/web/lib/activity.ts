/** Whether a reload would interrupt anyone (lib/updates.ts reads the document for it). */

/** How long without a tap or a key before a reload can't interrupt anything. */
export const QUIET_FOR = 30_000;
export type Activity = {
  /** A field has been typed in since this page was opened. */
  typed: boolean;
  /** A field has the focus, or a dialog is open. */
  engaged: boolean;
  /** Saves still on their way to the server. */
  saving: number;
  /** When the last tap or key was. */
  lastInput: number;
  /** The app is out of view (another tab, the phone locked). */
  hidden: boolean;
};

/** Whether someone is in the middle of something a reload would lose. */
export const working = (a: Activity) => a.typed || a.engaged || a.saving > 0;

/** Whether reloading now interrupts nobody: no work in hand, and no one using the app this
 * moment. Moving to another page is such a moment too (`navigating`): the reload lands there. */
export const canReload = (a: Activity, now: number, navigating = false) =>
  !working(a) && (navigating || a.hidden || now - a.lastInput >= QUIET_FOR);
