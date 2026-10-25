import { useState } from "react";

import { PasswordField } from "../components/PasswordField.js";
import { forgotPassword } from "../lib/session.js";
import { explain, useAuthConfig, useLogIn, useSignUp } from "../lib/queries.js";

type Mode = "log-in" | "sign-up" | "forgot";

/** The first thing a logged-out visitor sees: log in, create an account (anyone can on a public
 * server; on a private one, the emails it allows, until they all have one), or ask for a
 * password-reset email. After logging in you're wherever you were headed. */
export function Login() {
  const [mode, setMode] = useState<Mode>("log-in");
  const [email, setEmail] = useState("");
  return (
    <main className="welcome">
      <section className="hero">
        <h1>Your books, reviewed in seconds.</h1>
        <p>
          Double-entry accounting with Beancount underneath and a review queue built for your phone.
        </p>
      </section>
      {mode === "log-in" && <LogIn email={email} setEmail={setEmail} setMode={setMode} />}
      {mode === "sign-up" && <SignUp email={email} setEmail={setEmail} setMode={setMode} />}
      {mode === "forgot" && <Forgot email={email} setEmail={setEmail} setMode={setMode} />}
    </main>
  );
}

type FormProps = { email: string; setEmail: (e: string) => void; setMode: (m: Mode) => void };

function EmailField({ email, setEmail }: Pick<FormProps, "email" | "setEmail">) {
  return (
    <label>
      Email
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        aria-label="Email"
        required
      />
    </label>
  );
}

function LogIn({ email, setEmail, setMode }: FormProps) {
  const logIn = useLogIn();
  const config = useAuthConfig();
  const [password, setPassword] = useState("");
  return (
    <form
      className="card editor"
      aria-label="Log in"
      onSubmit={(e) => {
        e.preventDefault();
        logIn.mutate({ email: email.trim(), password });
      }}
    >
      <h2 className="section-title">Log in</h2>
      <EmailField email={email} setEmail={setEmail} />
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      {logIn.error && <p className="error">{explain(logIn.error)}</p>}
      <div className="actions">
        <button type="button" className="link-button" onClick={() => setMode("forgot")}>
          Forgot password?
        </button>
        <button type="submit" className="primary" disabled={logIn.isPending}>
          Log in
        </button>
      </div>
      {config.data?.signups_open && (
        <p className="center small">
          New here?{" "}
          <button type="button" className="link-button" onClick={() => setMode("sign-up")}>
            Create an account
          </button>
        </p>
      )}
      {config.data?.signups_open === false && (
        <p className="center small muted">
          This is a private instance: request access from the server administrator.
        </p>
      )}
    </form>
  );
}

function SignUp({ email, setEmail, setMode }: FormProps) {
  const signUp = useSignUp();
  const config = useAuthConfig();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const min = config.data?.password.min_length ?? 15;
  return (
    <form
      className="card editor"
      aria-label="Create an account"
      onSubmit={(e) => {
        e.preventDefault();
        signUp.mutate({ name: name.trim(), email: email.trim(), password });
      }}
    >
      <h2 className="section-title">Create an account</h2>
      {config.data?.service_mode === "private" && (
        <p className="small muted">
          This is a private instance: only the emails its administrator allows can create an
          account.
        </p>
      )}
      <label>
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          aria-label="Your name"
          required
        />
      </label>
      <EmailField email={email} setEmail={setEmail} />
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={`At least ${min} characters. A few unrelated words make a good one.`}
      />
      {signUp.error && <p className="error">{explain(signUp.error)}</p>}
      <div className="actions">
        <button type="button" onClick={() => setMode("log-in")}>
          I have an account
        </button>
        <button type="submit" className="primary" disabled={signUp.isPending}>
          Create account
        </button>
      </div>
    </form>
  );
}

function Forgot({ email, setEmail, setMode }: FormProps) {
  const config = useAuthConfig();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (config.data && !config.data.mail) {
    return (
      <section className="card">
        <h2 className="section-title">Forgot your password?</h2>
        <p>
          This server can't send email. Ask whoever runs it to make you a reset link (
          <code>reset-link</code> in the auth service's command line).
        </p>
        <button type="button" onClick={() => setMode("log-in")}>
          Back to log in
        </button>
      </section>
    );
  }
  return (
    <form
      className="card editor"
      aria-label="Forgot password"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await forgotPassword(email.trim());
          setSent(true);
        } catch (err) {
          setError(explain(err));
        }
      }}
    >
      <h2 className="section-title">Forgot your password?</h2>
      {sent ? (
        <p>If {email.trim()} has an account, a link to choose a new password is on its way.</p>
      ) : (
        <EmailField email={email} setEmail={setEmail} />
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" onClick={() => setMode("log-in")}>
          Back to log in
        </button>
        {!sent && (
          <button type="submit" className="primary">
            Send a reset link
          </button>
        )}
      </div>
    </form>
  );
}
