import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { PasswordField } from "../components/PasswordField.js";
import { explain, useAuthConfig } from "../lib/queries.js";
import { resetPassword, verifyEmail } from "../lib/session.js";

/** A password-reset link: choose a new password. Every session ends, so you log in again. */
export function ResetPassword({ token }: { token: string }) {
  const config = useAuthConfig();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return (
      <main>
        <p className="card done">
          Your password has been changed, and you've been logged out everywhere.{" "}
          <Link href="/">Log in</Link>
        </p>
      </main>
    );
  }
  return (
    <main>
      <form
        className="card editor"
        aria-label="Choose a new password"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await resetPassword(token, password);
            setDone(true);
          } catch (err) {
            setError(explain(err));
          }
        }}
      >
        <h2 className="section-title">Choose a new password</h2>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${config.data?.password.min_length ?? 15} characters.`}
        />
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary">
            Set password
          </button>
        </div>
      </form>
    </main>
  );
}

/** An email-verification link: confirms the address as soon as it's opened. */
export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"checking" | "done" | string>("checking");
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    verifyEmail(token).then(
      () => setState("done"),
      (err: unknown) => setState(explain(err))
    );
  }, [token]);
  return (
    <main>
      <p className={`card ${state === "done" ? "done" : ""}`}>
        {state === "checking" && "Checking…"}
        {state === "done" && "Your email address is confirmed."}
        {state !== "checking" && state !== "done" && <span className="error">{state}</span>}{" "}
        {state !== "checking" && <Link href="/">Go to Luminous Money</Link>}
      </p>
    </main>
  );
}
