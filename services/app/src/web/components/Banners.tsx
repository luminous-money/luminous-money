import { onlineManager } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { queryClient } from "../lib/queries.js";
import { serverReachable } from "../lib/session.js";
import { reloadNow, useUpdateWaiting } from "../lib/updates.js";

/** How often to try the server again while it isn't answering. */
const RETRY_EVERY = 15_000;

/**
 * What the whole app needs to say, at the top of the window: that it's offline or can't reach
 * the server (and what that means for what's shown and saved), or that a new version is
 * waiting for a reload (shown only while someone's working: otherwise it reloads by itself).
 */
export function Banners() {
  const online = useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline()
  );
  const reachable = useSyncExternalStore(serverReachable.subscribe, serverReachable.get);
  const update = useUpdateWaiting();

  // Online but unanswered (the server restarting, say): ask again now and then, and once it
  // answers, everything shown is read again.
  useEffect(() => {
    if (!online || reachable) return;
    const timer = window.setInterval(
      () => void queryClient.refetchQueries({ type: "active" }),
      RETRY_EVERY
    );
    return () => {
      window.clearInterval(timer);
      void queryClient.invalidateQueries();
      void queryClient.resumePausedMutations();
    };
  }, [online, reachable]);

  return (
    <div className="banners">
      {!online ? (
        <p className="banner banner-offline" role="status">
          <strong>You're offline.</strong> What's shown may be out of date; changes are kept and
          sent once you're back online.
        </p>
      ) : (
        !reachable && (
          <p className="banner banner-offline" role="status">
            <strong>Can't reach the server.</strong> Trying again; what's shown may be out of date
            until it answers.
          </p>
        )
      )}
      {update && (
        <p className="banner banner-update" role="status">
          <span>
            <strong>A new version is ready.</strong> Reload once you've saved what you're working
            on.
          </span>
          <button type="button" className="small-button" onClick={reloadNow}>
            Reload
          </button>
        </p>
      )}
    </div>
  );
}
