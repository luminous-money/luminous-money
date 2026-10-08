import { Link, Route, Router, Switch } from "wouter";

import { Home } from "./pages/Home.js";
import { Review } from "./pages/Review.js";
import { TransactionPage } from "./pages/TransactionPage.js";

export function App() {
  return (
    <Router base="/ui">
      <div className="shell">
        <header className="masthead">
          <Link href="/" className="brand">
            <img src="/ui/icon.svg" alt="" className="logo" />
            <span className="wordmark">fava-beans</span>
          </Link>
        </header>

        <Switch>
          <Route path="/">
            <Home />
          </Route>
          <Route path="/books/:book/review">{({ book }) => <Review book={book} />}</Route>
          <Route path="/books/:book/transactions/:id">
            {({ book, id }) => <TransactionPage key={id} book={book} id={id} />}
          </Route>
          <Route>
            <main>
              <p className="card">
                Nothing here. <Link href="/">Back to your books</Link>
              </p>
            </main>
          </Route>
        </Switch>

        <footer className="footer">Early build · nothing here touches real money yet</footer>
      </div>
    </Router>
  );
}
