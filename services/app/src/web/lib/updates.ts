/**
 * A new version of the app, taken in without losing anyone's work. The service worker
 * (vite-plugin-pwa, `registerType: "prompt"`) installs a new release in the background and waits;
 * the app asks for one on opening, every so often, and whenever it comes back into view. Once
 * one is waiting, it reloads into it by itself at the first moment nobody is working on anything,
 * and until then says at the top of the window that a reload will bring it in.
 *
 * "Working on something" is anything a reload could lose: a field typed in since the page was
 * opened (and not left by moving to another page), a field or dialog in use, or a save on its
 * way. "Idle": none of those, and no tap or key for a little while (or the app out of view).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";

import { canReload, type Activity } from "./activity.js";
import { queryClient } from "./queries.js";

/** How often to ask for a new version while the app is open. */
const CHECK_EVERY = 15 * 60_000;
/** How long a reload waits for the new version's service worker to take over. */
const TAKEOVER_WAIT = 10_000;

// What the user is doing, read from the document as a whole, so no form needs to say.
let typed = false;
let lastInput = Date.now();

function editable(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement)
    return !["button", "submit", "reset", "checkbox", "radio", "file"].includes(element.type);
  return (element as HTMLElement).isContentEditable === true;
}

function activity(): Activity {
  return {
    typed,
    engaged:
      editable(document.activeElement) || !!document.querySelector("dialog[open], [role=dialog]"),
    saving: queryClient.isMutating(),
    lastInput,
    hidden: document.visibilityState === "hidden",
  };
}

// Whether a new version is waiting, and the service worker's registration it waits in.
let waiting = false;
let registration: ServiceWorkerRegistration | undefined;
let reloading = false;
const listeners = new Set<() => void>();
const ready = () => waiting;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Take the new version in: its service worker takes over, then the page reloads, whatever
 * happens. The reload waits for the worker to be active, not for it to take this page over: a
 * page no worker controls (opened before one was installed, or by a hard reload) is never taken
 * over, and Reload did nothing there. No worker waiting (it's already in), it just reloads. */
export async function reloadNow() {
  if (reloading) return;
  reloading = true;
  const next = registration?.waiting;
  if (next)
    await new Promise<void>((resolve) => {
      next.addEventListener("statechange", () => {
        if (next.state === "activated" || next.state === "redundant") resolve();
      });
      window.setTimeout(resolve, TAKEOVER_WAIT);
      next.postMessage({ type: "SKIP_WAITING" });
    });
  window.location.reload();
}

/** Register the service worker and start watching for new versions. In development there's
 * none (Vite serves the source), so this does nothing there. */
export async function watchForUpdates() {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  document.addEventListener("input", () => (typed = true), true);
  for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
    document.addEventListener(event, () => (lastInput = Date.now()), {
      capture: true,
      passive: true,
    });

  const { registerSW } = await import("virtual:pwa-register");
  registerSW({
    onNeedRefresh() {
      waiting = true;
      listeners.forEach((listener) => listener());
    },
    onRegisteredSW(_url, registered) {
      if (!registered) return;
      registration = registered;
      const check = () => void registered.update().catch(() => undefined);
      window.setInterval(check, CHECK_EVERY);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
  // Waiting for a quiet moment: checked now and then, and the moment the app goes out of view.
  const tryNow = () => {
    if (waiting && canReload(activity(), Date.now())) void reloadNow();
  };
  window.setInterval(tryNow, 5_000);
  document.addEventListener("visibilitychange", tryNow);
}

/** Whether a new version is waiting; moving to another page with nothing in hand takes it in
 * then, and resets what's been typed (a page left is work done or let go). */
export function useUpdateWaiting(): boolean {
  const pending = useSyncExternalStore(subscribe, ready);
  const [location] = useLocation();
  const [opened, setOpened] = useState(location);
  useEffect(() => {
    if (location === opened) return;
    setOpened(location);
    if (waiting && canReload({ ...activity(), typed: false }, Date.now(), true)) void reloadNow();
    typed = false;
  }, [location, opened]);
  return pending;
}
