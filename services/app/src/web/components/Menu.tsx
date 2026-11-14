import { Menu as MenuIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Nav } from "./Nav.js";

/** How long the drawer takes to slide away (styles.css's nav-drawer-out). */
const CLOSING_MS = 200;

/** The menu on a phone (a wide screen has the sidebar instead): the main navigation over the
 * whole screen, sliding in from the right and back out; a choice, × or Escape closes it. */
export function Menu() {
  // "closing": still shown, sliding out, until it's gone.
  const [state, setState] = useState<"closed" | "open" | "closing">("closed");
  const open = state === "open";
  const button = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => setState((s) => (s === "open" ? "closing" : s));
  useEffect(() => {
    if (state !== "closing") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setState("closed"), reduced ? 0 : CLOSING_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  // Open, the drawer is all there is: focus goes into it, the page behind is out of reach
  // (inert) and doesn't scroll, and closing gives focus back to the menu button.
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById("root");
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", escape);
    document.body.classList.add("nav-drawer-open");
    root?.setAttribute("inert", "");
    closeButton.current?.focus();
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.classList.remove("nav-drawer-open");
      root?.removeAttribute("inert");
      button.current?.focus();
    };
  }, [open]);

  return (
    <div className="menu main-menu">
      <button
        ref={button}
        type="button"
        className="icon menu-button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setState(open ? "closing" : "open")}
      >
        <MenuIcon aria-hidden="true" />
      </button>
      {state !== "closed" &&
        createPortal(
          <div
            className={`nav-drawer${state === "closing" ? " closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="nav-drawer-head">
              <img src="/ui/icon.svg" alt="" className="logo" />
              <span className="wordmark">Luminous Money</span>
              <button
                ref={closeButton}
                type="button"
                className="icon"
                aria-label="Close menu"
                onClick={close}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <Nav onNavigate={close} />
          </div>,
          document.body
        )}
    </div>
  );
}
