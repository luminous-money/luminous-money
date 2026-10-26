import { useEffect, useState } from "react";
import { Link, Redirect, Route, Router, Switch, useLocation } from "wouter";

import { BookSwitcher } from "./components/BookSwitcher.js";
import { Menu } from "./components/Menu.js";
import type { BookInfo } from "./lib/appApi.js";
import { bookHome, rememberBook, startingBook, useBookInPath } from "./lib/books.js";
import { useBooks, useMe, useSessionLifecycle, useTimeZoneBackfill } from "./lib/queries.js";
import { Account } from "./pages/Account.js";
import { System } from "./pages/System.js";
import { AccountEditor } from "./pages/AccountEditor.js";
import { ChartOfAccounts } from "./pages/ChartOfAccounts.js";
import { BankConnections } from "./pages/BankConnections.js";
import { ResetPassword, VerifyEmail } from "./pages/EmailLinks.js";
import { AccountLedger } from "./pages/AccountLedger.js";
import { Reconcile } from "./pages/Reconcile.js";
import { AiSettings } from "./pages/AiSettings.js";
import { CaptureReceipt } from "./pages/CaptureReceipt.js";
import { ReceiptButton } from "./components/ReceiptButton.js";
import { AddAccount } from "./pages/AddAccount.js";
import { Books } from "./pages/Books.js";
import { Budgets } from "./pages/Budgets.js";
import { Reports } from "./pages/Reports.js";
import { InvitationPage } from "./pages/Invitation.js";
import { Sharing } from "./pages/Sharing.js";
import { Transactions } from "./pages/Transactions.js";
import { Home } from "./pages/Home.js";
import { Import } from "./pages/Import.js";
import { ImportChart } from "./pages/ImportChart.js";
import { Login } from "./pages/Login.js";
import { Commodities } from "./pages/Commodities.js";
import { Review } from "./pages/Review.js";
import { TradePage } from "./pages/TradePage.js";
import { RuleEditor } from "./pages/RuleEditor.js";
import { Rules } from "./pages/Rules.js";
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
 * up until it's finished (the book, then its first account); otherwise, the app. Every page but
 * Manage books is in a book (`/books/:book/…`): `/` opens the last one used here. */
function Gate() {
  const me = useMe();
  useSessionLifecycle(!!me.data);
  const books = useBooks();
  const user = me.data?.id ?? "";
  const inPath = useBookInPath();
  const [location] = useLocation();
  // An invitation opens even before you have a book of your own (it may be your first).
  const invitation = /^\/invite\/([^/?]+)/.exec(location)?.[1];
  const [settingUp, setSettingUp] = useState(false);
  const empty = books.data?.length === 0;
  useEffect(() => {
    if (me.data && empty && !invitation) setSettingUp(true);
  }, [me.data, empty, invitation]);
  useTimeZoneBackfill(books.data);
  const book = books.data?.find((b) => b.id === inPath);
  useEffect(() => {
    if (user && book) rememberBook(user, book.id);
  }, [user, book]);

  if (me.isPending) return <Masthead />;
  if (!me.data) {
    return (
      <>
        <Masthead />
        <Switch>
          <Route path="/reset/:token">{({ token }) => <ResetPassword token={token} />}</Route>
          <Route path="/verify/:token">{({ token }) => <VerifyEmail token={token} />}</Route>
          <Route>
            <Login />
          </Route>
        </Switch>
      </>
    );
  }
  if (!books.data) return <Masthead />;
  if (invitation && empty) {
    return (
      <>
        <Masthead />
        <InvitationPage token={decodeURIComponent(invitation)} />
      </>
    );
  }
  if (empty || settingUp) {
    return (
      <>
        <Masthead />
        <Setup book={books.data[0]} onDone={() => setSettingUp(false)} />
      </>
    );
  }

  const start = startingBook(user, books.data)!;
  return (
    <>
      <Masthead books={books.data} book={book ?? (inPath ? undefined : start)} />
      {book?.role === "read" && (
        <p className="readonly-note small" role="status">
          You can see {book.name}, but not change it.
        </p>
      )}
      {inPath && !book ? (
        <NotFound />
      ) : (
        <Switch>
          <Route path="/">
            <Redirect to={bookHome(start.id)} replace />
          </Route>
          <Route path="/books">
            <Books />
          </Route>
          <Route path="/account">
            <Account />
          </Route>
          <Route path="/system">
            <System />
          </Route>
          <Route path="/verify/:token">{({ token }) => <VerifyEmail token={token} />}</Route>
          <Route path="/invite/:token">
            {({ token }) => <InvitationPage key={token} token={token} />}
          </Route>
          <Route path="/books/:book/sharing">
            {({ book: id }) => <Sharing key={id} book={id} />}
          </Route>
          <Route path="/books/:book">{() => <Home key={book!.id} book={book!} />}</Route>
          <Route path="/books/:book/accounts">
            {({ book: id }) => <ChartOfAccounts key={id} book={id} />}
          </Route>
          <Route path="/books/:book/budgets">
            {({ book: id }) => <Budgets key={id} book={id} />}
          </Route>
          <Route path="/books/:book/transactions">
            {({ book: id }) => <Transactions key={id} book={id} />}
          </Route>
          <Route path="/books/:book/reports">
            {({ book: id }) => <Reports key={id} book={id} />}
          </Route>
          <Route path="/books/:book/accounts/:account/edit">
            {({ book: id, account }) => (
              <AccountEditor key={account} book={id} account={decodeURIComponent(account)} />
            )}
          </Route>
          <Route path="/books/:book/accounts/new">
            {() => <AddAccount key={book!.id} book={book!} />}
          </Route>
          <Route path="/books/:book/accounts/import">
            {() => <ImportChart key={book!.id} book={book!} />}
          </Route>
          <Route path="/books/:book/accounts/:account/trade">
            {({ book: id, account }) => (
              <TradePage key={account} book={id} account={decodeURIComponent(account)} />
            )}
          </Route>
          <Route path="/books/:book/receipt">
            {({ book: id }) => <CaptureReceipt key={id} book={id} />}
          </Route>
          <Route path="/books/:book/ai">
            {({ book: id }) => <AiSettings key={id} book={id} />}
          </Route>
          <Route path="/books/:book/accounts/:account/reconcile">
            {({ book: id, account }) => (
              <Reconcile key={account} book={id} account={decodeURIComponent(account)} />
            )}
          </Route>
          <Route path="/books/:book/accounts/:account">
            {({ book: id, account }) => (
              <AccountLedger key={account} book={id} account={decodeURIComponent(account)} />
            )}
          </Route>
          <Route path="/books/:book/import">
            {({ book: id }) => <Import key={id} book={id} />}
          </Route>
          <Route path="/books/:book/commodities">
            {({ book: id }) => <Commodities key={id} book={id} />}
          </Route>
          <Route path="/books/:book/rules">{({ book: id }) => <Rules key={id} book={id} />}</Route>
          <Route path="/books/:book/rules/new">
            {({ book: id }) => <RuleEditor key="new" book={id} />}
          </Route>
          <Route path="/books/:book/rules/:id">
            {({ book: id, id: rule }) => <RuleEditor key={rule} book={id} id={rule} />}
          </Route>
          <Route path="/books/:book/schedules">
            {({ book: id }) => <Schedules key={id} book={id} />}
          </Route>
          <Route path="/books/:book/schedules/new">
            {({ book: id }) => <ScheduleEditor key="new" book={id} />}
          </Route>
          <Route path="/books/:book/schedules/:id">
            {({ book: id, id: schedule }) => (
              <ScheduleEditor key={schedule} book={id} id={schedule} />
            )}
          </Route>
          <Route path="/books/:book/connections">
            {({ book: id }) => <BankConnections key={id} book={id} />}
          </Route>
          <Route path="/books/:book/review">
            {({ book: id }) => <Review key={id} book={id} />}
          </Route>
          <Route path="/books/:book/transactions/new">
            {({ book: id }) => <NewTransactionPage book={id} />}
          </Route>
          <Route path="/books/:book/transactions/:id">
            {({ book: id, id: transaction }) => (
              <TransactionPage key={transaction} book={id} id={transaction} />
            )}
          </Route>
          <Route>
            <NotFound />
          </Route>
        </Switch>
      )}
    </>
  );
}

function NotFound() {
  return (
    <main>
      <p className="card">
        Nothing here. <Link href="/">Back home</Link>
      </p>
    </main>
  );
}

/** The brand; once you're in, the book switcher and the menu (and on a phone, the logo alone:
 * they need the room). */
function Masthead({ books, book }: { books?: BookInfo[]; book?: BookInfo }) {
  return (
    <header className="masthead">
      <Link href="/" className={`brand${books ? " signed-in" : ""}`} aria-label="Luminous Money">
        <img src="/ui/icon.svg" alt="" className="logo" />
        <span className="wordmark">Luminous Money</span>
      </Link>
      {books && (
        <div className="masthead-end">
          {book && <ReceiptButton book={book.id} />}
          <BookSwitcher books={books} book={book} />
          <Menu />
        </div>
      )}
    </header>
  );
}
