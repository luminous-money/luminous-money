import { useState } from "react";
import { Link, useLocation } from "wouter";

import type { BookInvite, BookMember, Role } from "../lib/appApi.js";
import {
  explain,
  useBooks,
  useInvite,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useSetRole,
} from "../lib/queries.js";

export const ROLE_NAMES: Record<Role, string> = {
  owner: "Owner",
  manage: "Can manage",
  write: "Can edit",
  read: "Can view",
};
const ROLE_HINTS: Record<BookInvite["role"], string> = {
  read: "sees everything, changes nothing",
  write: "changes what's in the book",
  manage: "and who has it, and its name",
};
const ROLES: BookInvite["role"][] = ["read", "write", "manage"];

/**
 * Who has a book (M13): its owner and members with their roles, which managers change or
 * remove; anyone can leave. Managers invite by link (a role, and who it's for), and see the
 * invitations still open.
 */
export function Sharing({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const me = useMe();
  const info = useBooks().data?.find((b) => b.id === book);
  const sharing = useMembers(book);
  const setRole = useSetRole(book);
  const remove = useRemoveMember(book);
  const managing = sharing.data?.role === "owner" || sharing.data?.role === "manage";

  const row = (m: BookMember) => {
    const you = m.user_id === me.data?.id;
    const name = m.name ?? "Someone";
    return (
      <li key={m.user_id} className="member">
        <span className="member-who">
          <span className="member-name">
            {name}
            {you && <span className="muted"> (you)</span>}
          </span>
          {m.email && <span className="small muted">{m.email}</span>}
        </span>
        {m.role === "owner" || !managing ? (
          <span className="pill">{ROLE_NAMES[m.role]}</span>
        ) : (
          <select
            aria-label={`${name}'s role`}
            value={m.role}
            disabled={setRole.isPending}
            onChange={(e) =>
              setRole.mutate({
                user: m.user_id,
                role: e.target.value as BookInvite["role"],
                updatedAt: m.updated_at!,
              })
            }
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </select>
        )}
        {m.role !== "owner" && (you || managing) && (
          <button
            type="button"
            className="plain"
            disabled={remove.isPending}
            onClick={() => remove.mutate(m.user_id, { onSuccess: () => you && navigate("/books") })}
          >
            {you ? "Leave" : "Remove"}
          </button>
        )}
      </li>
    );
  };

  return (
    <main className="stack">
      <header className="page-head">
        <Link href="/books" className="back">
          ‹ Books
        </Link>
        <h1>Sharing</h1>
        <p className="muted">{info?.name}</p>
      </header>
      {sharing.isPending && <p className="muted">Loading…</p>}
      {sharing.error && <p className="card error">{explain(sharing.error)}</p>}
      {sharing.data && (
        <section className="card" aria-label="People">
          <h2 className="section-title">People</h2>
          <ul className="members">{sharing.data.members.map(row)}</ul>
          {(setRole.error || remove.error) && (
            <p className="error">{explain(setRole.error ?? remove.error)}</p>
          )}
        </section>
      )}
      {managing && <InviteForm book={book} />}
      {managing && !!sharing.data?.invites.length && (
        <OpenInvites book={book} invites={sharing.data.invites} />
      )}
    </main>
  );
}

function InviteForm({ book }: { book: string }) {
  const invite = useInvite(book);
  const [role, setRole] = useState<BookInvite["role"]>("write");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const link = invite.data && `${window.location.origin}/ui/invite/${invite.data.token}`;
  return (
    <section className="card editor" aria-label="Invite someone">
      <h2 className="section-title">Invite someone</h2>
      {link ? (
        <>
          <p className="small">
            Send this link to {invite.data!.label ?? invite.data!.email}. It works for the account
            with that email, once, for 3 days.
          </p>
          <input
            readOnly
            value={link}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="actions">
            <button
              type="button"
              onClick={() => (invite.reset(), setEmail(""), setLabel(""), setCopied(false))}
            >
              Another
            </button>
            {"share" in navigator && (
              <button
                type="button"
                onClick={() => void navigator.share({ title: "Join my book", url: link })}
              >
                Share…
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({ role, email, label });
          }}
        >
          <label>
            They
            <select
              aria-label="Their role"
              value={role}
              onChange={(e) => setRole(e.target.value as BookInvite["role"])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r]}: {ROLE_HINTS[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Their email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jess@example.com"
              aria-label="Their email"
              autoComplete="off"
            />
            <span className="small muted">Only their account can accept it.</span>
          </label>
          <label>
            Their name (optional)
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Jess"
              aria-label="Their name"
            />
          </label>
          {invite.error && <p className="error">{explain(invite.error)}</p>}
          <div className="actions">
            <button type="submit" className="primary" disabled={invite.isPending}>
              Make a link
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function OpenInvites({ book, invites }: { book: string; invites: BookInvite[] }) {
  const revoke = useRevokeInvite(book);
  return (
    <section className="card" aria-label="Open invitations">
      <h2 className="section-title">Open invitations</h2>
      <ul className="members">
        {invites.map((i) => (
          <li key={i.id} className="member">
            <span className="member-who">
              <span className="member-name">{i.label ?? i.email ?? "Anyone with the link"}</span>
              <span className="small muted">
                {i.label && i.email ? `${i.email} · ` : ""}
                {ROLE_NAMES[i.role]} · until {i.expires_at.slice(0, 10)}
              </span>
            </span>
            <button
              type="button"
              className="plain"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(i.id)}
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
