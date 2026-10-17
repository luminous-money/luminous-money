import { Link, useLocation } from "wouter";

import { bookHome } from "../lib/books.js";
import { explain, useAcceptInvitation, useInvitation } from "../lib/queries.js";
import { ROLE_NAMES } from "./Sharing.js";

const VERBS = {
  read: "see it",
  write: "see and change it",
  manage: "see and change it, and share it",
};

/** An invitation to a book (M13): who invited you to which, as what; Accept opens the book. */
export function InvitationPage({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const invitation = useInvitation(token);
  const accept = useAcceptInvitation();
  const i = invitation.data;
  return (
    <main className="stack">
      <header className="page-head">
        <h1>An invitation</h1>
      </header>
      {invitation.isPending && <p className="muted">Loading…</p>}
      {invitation.error && <p className="card error">{explain(invitation.error)}</p>}
      {i && (
        <section className="card editor" aria-label="Invitation">
          <p>
            {i.invited_by ?? "Someone"} invited you to <b>{i.book.name}</b>, to {VERBS[i.role]} (
            {ROLE_NAMES[i.role].toLowerCase()}).
          </p>
          {i.member ? (
            <p className="small">
              You have this book already. <Link href={bookHome(i.book.id)}>Open it</Link>
            </p>
          ) : i.state !== "open" ? (
            <p className="small error">
              {i.state === "used"
                ? "This invitation was already used."
                : "This invitation has expired."}{" "}
              Ask for a new one.
            </p>
          ) : (
            <>
              {accept.error && <p className="error">{explain(accept.error)}</p>}
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={accept.isPending}
                  onClick={() =>
                    accept.mutate(token, { onSuccess: (r) => navigate(bookHome(r.book)) })
                  }
                >
                  {accept.isPending ? "Joining…" : "Accept"}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
