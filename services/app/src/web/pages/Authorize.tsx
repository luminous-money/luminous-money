import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { explain } from "../lib/queries.js";
import { oauth, type AppRequest } from "../lib/session.js";

/** The authorization request in the address (an app sent you here). */
function request(): AppRequest {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

/**
 * Connecting an app (OAuth's consent, for MCP clients like Claude): who's asking to act as you,
 * and where you'd go back to; Allow or Deny sends you back to the app. Logged out, you log in
 * first, on this same address.
 */
export function Authorize() {
  const [asked] = useState(request);
  const check = useQuery({
    queryKey: ["oauth", asked],
    queryFn: () => oauth.check(asked),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (decision: "allow" | "deny") => oauth.decide(asked, decision),
    onSuccess: ({ redirect }) => window.location.assign(redirect),
  });

  return (
    <main className="welcome">
      <section className="card editor" aria-label="Connect an app">
        <h1 className="section-title">Connect an app</h1>
        {check.isPending && <p className="muted">Checking the request…</p>}
        {check.error && <p className="error">{explain(check.error)}</p>}
        {check.data && (
          <>
            <p>
              <strong>{check.data.client_name}</strong> wants to use Luminous Money as you.
            </p>
            <p className="small muted">
              It can see and change your books as you can in the app. You can disconnect it from
              your account page at any time. Allowing returns you to {check.data.redirect_host}.
            </p>
            {decide.error && <p className="error">{explain(decide.error)}</p>}
            <div className="actions">
              <button
                type="button"
                onClick={() => decide.mutate("deny")}
                disabled={decide.isPending || decide.isSuccess}
              >
                Deny
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => decide.mutate("allow")}
                disabled={decide.isPending || decide.isSuccess}
              >
                Allow
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
