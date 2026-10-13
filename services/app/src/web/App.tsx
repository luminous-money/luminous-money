import { useEffect, useState } from "react";
import { Link, Route, Router, Switch } from "wouter";

import { Menu } from "./components/Menu.js";
import { useCurrentBook, useMe } from "./lib/queries.js";
import { AccountLedger } from "./pages/AccountLedger.js";
import { AddAccount } from "./pages/AddAccount.js";
import { Books } from "./pages/Books.js";
import { Home } from "./pages/Home.js";
import { Import } from "./pages/Import.js";
import { Login } from "./pages/Login.js";
import { Review } from "./pages/Review.js";
import { ScheduleEditor } from "./pages/ScheduleEditor.js";
import { Schedules } from "./pages/Schedules.js";
import { Setup } from "./pages/Setup.js";
import { NewTransactionPage, TransactionPage } from "./pages/TransactionPage.js";

export function App() {
  return (
    <Router base="/ui">
      <div className="shell">
        <Gate />
        <footer className="footer">Early build · nothing here touches real money yet</footer>
      </div>
    </Router>
  );
}

/** Where you land: logged out, the login screen; a new user (no books yet), setup, which stays
 * up until it's finished (the book, then its first account); otherwise, the app. */
function Gate() {
  const me = useMe();
  const { book, loading } = useCurrentBook();
  const [settingUp, setSettingUp] = useState(false);
  useEffect(() => {
    if (me.data && !loading && !book) setSettingUp(true);
  }, [me.data, loading, book]);

  if (me.isPending) return <Masthead />;
  if (!me.data) {
    return (
      <>
        <Masthead />
        <Login />
      </>
    );
  }
  if (loading) return <Masthead />;
  if (!book || settingUp) {
    return (
      <>
        <Masthead />
        <Setup book={book} onDone={() => setSettingUp(false)} />
      </>
    );
  }

  return (
    <>
      <Masthead menu />
      <Switch>
        <Route path="/">
          <Home book={book} />
        </Route>
        <Route path="/books">
          <Books />
        </Route>
        <Route path="/accounts/new">
          <AddAccount book={book} />
        </Route>
        <Route path="/import">
          <Import book={book.id} />
        </Route>
        <Route path="/books/:book/accounts/:account">
          {({ book: id, account }) => (
            <AccountLedger key={account} book={id} account={decodeURIComponent(account)} />
          )}
        </Route>
        <Route path="/books/:book/import">{({ book: id }) => <Import key={id} book={id} />}</Route>
        <Route path="/books/:book/schedules">{({ book: id }) => <Schedules book={id} />}</Route>
        <Route path="/books/:book/schedules/new">
          {({ book: id }) => <ScheduleEditor key="new" book={id} />}
        </Route>
        <Route path="/books/:book/schedules/:id">
          {({ book: id, id: schedule }) => (
            <ScheduleEditor key={schedule} book={id} id={schedule} />
          )}
        </Route>
        <Route path="/books/:book/review">{({ book: id }) => <Review book={id} />}</Route>
        <Route path="/books/:book/transactions/new">
          {({ book: id }) => <NewTransactionPage book={id} />}
        </Route>
        <Route path="/books/:book/transactions/:id">
          {({ book: id, id: transaction }) => (
            <TransactionPage key={transaction} book={id} id={transaction} />
          )}
        </Route>
        <Route>
          <main>
            <p className="card">
              Nothing here. <Link href="/">Back home</Link>
            </p>
          </main>
        </Route>
      </Switch>
    </>
  );
}

function Masthead({ menu = false }: { menu?: boolean }) {
  return (
    <header className="masthead">
      <Link href="/" className="brand">
        <img src="/ui/icon.svg" alt="" className="logo" />
        <span className="wordmark">fava-beans</span>
      </Link>
      {menu && <Menu />}
    </header>
  );
}
