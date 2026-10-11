import { explain, useLogIn } from "../lib/queries.js";

/** The first thing a logged-out visitor sees. Creating an account comes with M6. */
export function Login() {
  const logIn = useLogIn();
  return (
    <main className="welcome">
      <section className="hero">
        <h1>Your books, reviewed in seconds.</h1>
        <p>
          Double-entry accounting with Beancount underneath and a review queue built for your phone.
        </p>
      </section>
      <div className="card stack">
        <button
          type="button"
          className="primary"
          disabled={logIn.isPending}
          onClick={() => logIn.mutate()}
        >
          Log in
        </button>
        <button type="button" disabled title="Coming soon">
          Create account
        </button>
        {logIn.error && <p className="error">{explain(logIn.error)}</p>}
      </div>
    </main>
  );
}
