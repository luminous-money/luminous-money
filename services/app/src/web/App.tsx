import { useEffect, useState } from "react";

import { ledger } from "./ledger.js";

type LedgerStatus =
  { state: "checking" } | { state: "connected"; books: string[] } | { state: "unreachable" };

function useLedgerStatus(): LedgerStatus {
  const [status, setStatus] = useState<LedgerStatus>({ state: "checking" });
  useEffect(() => {
    let cancelled = false;
    ledger
      .GET("/api/ledger/v1/books")
      .then(({ data, response }) => {
        if (cancelled) return;
        setStatus(
          response.ok && data ? { state: "connected", books: data } : { state: "unreachable" }
        );
      })
      .catch(() => !cancelled && setStatus({ state: "unreachable" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

export function App() {
  const status = useLedgerStatus();

  return (
    <div className="shell">
      <header className="masthead">
        <img src="/ui/icon.svg" alt="" className="logo" />
        <span className="wordmark">fava-beans</span>
      </header>

      <main>
        <section className="hero">
          <h1>Your books, reviewed in seconds.</h1>
          <p>
            Double-entry accounting with Beancount underneath and a review queue built for your
            phone.
          </p>
        </section>

        <section className="card status" aria-live="polite">
          <h2>Ledger</h2>
          <StatusLine status={status} />
        </section>

        <section className="tiles">
          <Tile title="Review queue" note="Confirm imported transactions with one tap." soon />
          <Tile title="Import" note="Bank feeds and CSV uploads." soon />
          <Tile title="Schedules" note="Recurring transactions across books." soon />
          <Tile
            title="Reports"
            note="Balance sheet, income statement and queries in Fava."
            href="/fava/"
          />
        </section>
      </main>

      <footer className="footer">Early build · nothing here touches real money yet</footer>
    </div>
  );
}

function StatusLine({ status }: { status: LedgerStatus }) {
  switch (status.state) {
    case "checking":
      return <p className="muted">Checking…</p>;
    case "unreachable":
      return (
        <p>
          <span className="dot bad" /> Unreachable
        </p>
      );
    case "connected":
      return (
        <p>
          <span className="dot good" /> Connected · {status.books.length}{" "}
          {status.books.length === 1 ? "book" : "books"}
        </p>
      );
  }
}

function Tile({
  title,
  note,
  href,
  soon,
}: {
  title: string;
  note: string;
  href?: string;
  soon?: boolean;
}) {
  const body = (
    <>
      <h3>
        {title}
        {soon && <span className="badge">Soon</span>}
      </h3>
      <p>{note}</p>
    </>
  );
  return href ? (
    <a className="card tile link" href={href}>
      {body}
    </a>
  ) : (
    <div className="card tile">{body}</div>
  );
}
