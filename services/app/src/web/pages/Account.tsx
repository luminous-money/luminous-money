import { useState } from "react";

import { PasswordField } from "../components/PasswordField.js";
import { formatWhen } from "../lib/format.js";
import {
  explain,
  useAccountChange,
  useApiTokens,
  useAuthConfig,
  useDeleteAccount,
  useMe,
  useSessions,
  useUpdateAccount,
} from "../lib/queries.js";
import { account, type User } from "../lib/session.js";

/** Your account: name and email, password, the devices you're logged in on, API tokens for
 * scripts, and deleting it all. */
export function Account() {
  const me = useMe();
  if (!me.data) return null;
  return (
    <main className="stack">
      <header className="page-head">
        <h1>Your account</h1>
      </header>
      <Profile user={me.data} />
      <Password />
      <Devices />
      <Tokens />
      <DeleteAccount />
    </main>
  );
}

function Profile({ user }: { user: User }) {
  const update = useUpdateAccount();
  const resend = useAccountChange(account.resendVerification);
  const config = useAuthConfig();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const changingEmail = email.trim().toLowerCase() !== user.email.toLowerCase();
  const changed = name.trim() !== user.name || email.trim() !== user.email;
  return (
    <form
      className="card editor"
      aria-label="Profile"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          {
            name: name.trim(),
            email: email.trim(),
            password: changingEmail ? password : undefined,
            updated_at: user.updated_at,
          },
          { onSuccess: () => setPassword("") }
        );
      }}
    >
      <h2 className="section-title">Profile</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
        />
      </label>
      {config.data?.mail && !user.email_verified && !changingEmail && (
        <p className="small muted">
          Not confirmed yet.{" "}
          <button type="button" className="link-button" onClick={() => resend.mutate(undefined)}>
            {resend.isSuccess ? "Sent: check your email" : "Send the link again"}
          </button>
          {resend.error && <span className="error"> {explain(resend.error)}</span>}
        </p>
      )}
      {changingEmail && (
        <PasswordField
          label="Your password, to change your email"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      )}
      {update.error && <p className="error">{explain(update.error)}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!changed || update.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

function Password() {
  const change = useAccountChange(({ current, password }: { current: string; password: string }) =>
    account.changePassword(current, password)
  );
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="card editor"
      aria-label="Change password"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate(
          { current, password },
          { onSuccess: () => (setCurrent(""), setPassword("")) }
        );
      }}
    >
      <h2 className="section-title">Password</h2>
      <PasswordField
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />
      <PasswordField
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint="At least 15 characters. You'll stay logged in here; other devices are logged out."
      />
      {change.error && <p className="error">{explain(change.error)}</p>}
      {change.isSuccess && <p className="ok">Password changed.</p>}
      <div className="actions">
        <button
          type="submit"
          className="primary"
          disabled={!current || !password || change.isPending}
        >
          Change password
        </button>
      </div>
    </form>
  );
}

function Devices() {
  const sessions = useSessions();
  const end = useAccountChange(account.endSession);
  const endOthers = useAccountChange(account.endOthers);
  const others = (sessions.data ?? []).filter((s) => !s.current).length;
  return (
    <section className="card" aria-label="Devices">
      <h2 className="section-title">Devices</h2>
      <p className="small muted">
        Where you're logged in. A device that's unused for 60 days is logged out.
      </p>
      <ul className="plain-list">
        {sessions.data?.map((s) => (
          <li key={s.id} className="row-between">
            <span>
              {s.device}
              {s.current && <span className="pill"> this device</span>}
              <span className="muted small block">
                Logged in {formatWhen(s.created_at)} · last active {formatWhen(s.last_used_at)}
              </span>
            </span>
            {!s.current && (
              <button
                type="button"
                onClick={() => end.mutate(s.id)}
                aria-label={`Log out ${s.device}`}
              >
                Log out
              </button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <div className="actions">
          <button type="button" onClick={() => endOthers.mutate(undefined)}>
            Log out everywhere else
          </button>
        </div>
      )}
    </section>
  );
}

function Tokens() {
  const tokens = useApiTokens();
  const create = useAccountChange(({ name, days }: { name: string; days: number | null }) =>
    account.createToken(name, days)
  );
  const revoke = useAccountChange(account.revokeToken);
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  return (
    <section className="card" aria-label="API tokens">
      <h2 className="section-title">API tokens</h2>
      <p className="small muted">
        For scripts: scheduled backups, <code>pnpm seed</code>. A token can do anything you can,
        except change this account. Send it as <code>Authorization: Bearer …</code>.
      </p>
      <ul className="plain-list">
        {tokens.data?.map((t) => (
          <li key={t.id} className="row-between">
            <span>
              {t.name} <span className="muted small">…{t.hint}</span>
              <span className="muted small block">
                {t.last_used_at ? `Last used ${formatWhen(t.last_used_at)}` : "Never used"}
                {t.expires_at ? ` · expires ${formatWhen(t.expires_at)}` : " · doesn't expire"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => revoke.mutate(t.id)}
              aria-label={`Revoke ${t.name}`}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {create.data && (
        <p className="card done small" role="status">
          Copy your new token now; it won't be shown again:
          <code className="block secret">{create.data.secret}</code>
        </p>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: name.trim(), days: days ? Number(days) : null },
            { onSuccess: () => setName("") }
          );
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Token name"
            placeholder="e.g. backups"
          />
        </label>
        <label>
          Expires
          <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Expires">
            <option value="30">in 30 days</option>
            <option value="90">in 90 days</option>
            <option value="365">in a year</option>
            <option value="">never</option>
          </select>
        </label>
        <button type="submit" disabled={!name.trim() || create.isPending}>
          Create token
        </button>
      </form>
      {create.error && <p className="error">{explain(create.error)}</p>}
    </section>
  );
}

function DeleteAccount() {
  const remove = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  if (!open) {
    return (
      <section className="card" aria-label="Delete account">
        <h2 className="section-title">Delete account</h2>
        <p className="small muted">Deletes your account and every book you own, for good.</p>
        <button type="button" className="danger" onClick={() => setOpen(true)}>
          Delete account…
        </button>
      </section>
    );
  }
  return (
    <form
      className="card editor"
      aria-label="Delete account"
      onSubmit={(e) => {
        e.preventDefault();
        remove.mutate(password);
      }}
    >
      <h2 className="section-title">Delete your account?</h2>
      <p>
        Your account and every book you own are deleted for good: accounts, transactions, schedules,
        rules, import history. Export any book you want to keep first, in Manage books.
      </p>
      <PasswordField
        label="Your password, to confirm"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      {remove.error && <p className="error">{explain(remove.error)}</p>}
      <div className="actions">
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="danger" disabled={!password || remove.isPending}>
          Delete everything
        </button>
      </div>
    </form>
  );
}
