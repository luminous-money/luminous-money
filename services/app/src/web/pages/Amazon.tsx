/**
 * A book's Amazon (the Amazon orders spike, 2026-11-06): the connection (the Amazon account's
 * email, password and authenticator setup key, how far back to read, and where payments other
 * than a card come from), Sync now, and what it read: each charge with the order behind it.
 * Nothing here writes to the books yet; that's the next step, once reading is proven.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { postable } from "../lib/accounts.js";
import { bookHome } from "../lib/books.js";
import { formatAmount, formatFullDay, formatWhen, today } from "../lib/format.js";
import { explain, useAccountCreation, useAccounts, useRole } from "../lib/queries.js";
import {
  amazonUrl,
  shopsApi,
  type AmazonCharge,
  type AmazonConnection,
  type AmazonPatch,
} from "../lib/shops.js";

type Choice = "include" | "exclude" | "";

/** Each card's choice, from the connection's lists. */
const choicesOf = (c: AmazonConnection): Map<string, Choice> =>
  new Map<string, Choice>([
    ...c.cards.map((card) => [card.last4, ""] as [string, Choice]),
    ...c.include_cards.map((n) => [n, "include"] as [string, Choice]),
    ...c.exclude_cards.map((n) => [n, "exclude"] as [string, Choice]),
  ]);

const listOf = (choices: Map<string, Choice>, choice: Choice) =>
  [...choices]
    .filter(([, c]) => c === choice)
    .map(([n]) => n)
    .sort();

const same = (a: string[], b: string[]) => a.join() === [...b].sort().join();

const keys = {
  health: ["shops", "health"] as const,
  amazon: (book: string) => ["shops", book, "amazon"] as const,
  sync: (book: string) => ["shops", book, "amazon", "sync"] as const,
  charges: (book: string) => ["shops", book, "amazon", "charges"] as const,
};

export function AmazonPage({ book }: { book: string }) {
  const health = useQuery({ queryKey: keys.health, queryFn: shopsApi.health });
  const connection = useQuery({
    queryKey: keys.amazon(book),
    queryFn: () => shopsApi.amazon(book),
    enabled: !!health.data,
  });
  const role = useRole(book);
  const manage = role === "owner" || role === "manage";
  const write = manage || role === "write";
  return (
    <main className="stack">
      <header className="page-head">
        <Link href={bookHome(book)} className="back">
          ‹ Home
        </Link>
        <h1>Amazon</h1>
        <p className="muted">
          Your Amazon charges and the orders behind them, read from Amazon. A first version: it
          reads them, and doesn&apos;t write anything to the books yet.
        </p>
      </header>
      {health.isPending && <p className="muted">Loading…</p>}
      {health.data === null && (
        <p className="card">The shops service isn&apos;t running, so Amazon can&apos;t be read.</p>
      )}
      {connection.error && <p className="card error">{explain(connection.error)}</p>}
      {connection.data && (
        <>
          <Settings
            key={connection.data.updated_at ?? "new"}
            book={book}
            connection={connection.data}
            manage={manage}
          />
          <Sync book={book} connection={connection.data} write={write} />
          <Charges book={book} />
        </>
      )}
    </main>
  );
}

function Settings({
  book,
  connection: c,
  manage,
}: {
  book: string;
  connection: AmazonConnection;
  manage: boolean;
}) {
  const client = useQueryClient();
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const names = accounts.data ? postable(accounts.data, today()) : [];
  const [email, setEmail] = useState(c.email);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [from, setFrom] = useState(c.sync_from ?? "");
  const [other, setOther] = useState(c.other_payments);
  const [rewards, setRewards] = useState(c.rewards ?? "");
  const [choices, setChoices] = useState(() => choicesOf(c));
  const [newCard, setNewCard] = useState("");
  const choose = (last4: string, choice: Choice) =>
    setChoices((m) => new Map(m).set(last4, choice));
  const addCard = () => {
    const last4 = newCard.trim();
    if (!/^\d{2,6}$/.test(last4))
      return setMessage({ kind: "error", text: "A card is its last four digits, like 1234" });
    setMessage(null);
    choose(last4, "include");
    setNewCard("");
  };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const save = async () => {
    const patch: AmazonPatch = { updated_at: c.updated_at };
    if (email !== c.email) patch.email = email;
    if (password) patch.password = password;
    if (otp) patch.otp_secret = otp;
    if ((from || null) !== c.sync_from) patch.sync_from = from || null;
    if (other !== c.other_payments) patch.other_payments = other;
    if ((rewards || null) !== c.rewards) patch.rewards = rewards || null;
    const include = listOf(choices, "include");
    const exclude = listOf(choices, "exclude");
    if (!same(include, c.include_cards)) patch.include_cards = include;
    if (!same(exclude, c.exclude_cards)) patch.exclude_cards = exclude;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await shopsApi.patchAmazon(book, patch);
      client.setQueryData(keys.amazon(book), saved);
      void client.invalidateQueries({ queryKey: keys.charges(book) });
    } catch (e) {
      setMessage({ kind: "error", text: explain(e) });
      void client.invalidateQueries({ queryKey: keys.amazon(book) });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!c.updated_at) return;
    if (!window.confirm("Forget this Amazon account, and everything read from it?")) return;
    try {
      await shopsApi.forgetAmazon(book, c.updated_at);
      void client.invalidateQueries({ queryKey: ["shops", book] });
    } catch (e) {
      setMessage({ kind: "error", text: explain(e) });
    }
  };

  return (
    <form
      className="card editor"
      aria-label="Amazon account"
      onSubmit={(e) => (e.preventDefault(), void save())}
    >
      <h2 className="section-title">Amazon account</h2>
      {!c.sealing && (
        <p className="error small">
          The shops service has no key to keep a password with (SHOPS_ENCRYPTION_KEY or
          AI_ENCRYPTION_KEY): it can&apos;t be set up until it has one.
        </p>
      )}
      <label>
        Email
        <input
          type="email"
          autoComplete="off"
          value={email}
          disabled={!manage}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          disabled={!manage}
          placeholder={c.has_password ? "Set: type a new one to replace it" : ""}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Authenticator setup key
        <input
          autoComplete="off"
          spellCheck={false}
          value={otp}
          disabled={!manage}
          placeholder={
            c.has_otp_secret ? "Set: type a new one to replace it" : "Like JBSW Y3DP EHPK 3PXP…"
          }
          onChange={(e) => setOtp(e.target.value)}
        />
      </label>
      <p className="small muted">
        So it can make Amazon&apos;s two-step codes itself. On Amazon: Your Account → Login &amp;
        security → 2-Step Verification → Add new app, then &ldquo;Can&apos;t scan the
        barcode?&rdquo; shows the key. Add the same key to your authenticator app too, and use its
        code to finish on Amazon.
      </p>
      <label>
        Read charges from
        <input
          type="date"
          value={from}
          disabled={!manage}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <p className="small muted">The first sync reads back to here (the last 30 days if blank).</p>
      <div className="field">
        <span className="field-label">Gift cards and other payments come from</span>
        <AccountPicker
          label="Gift cards and other payments come from"
          accounts={names}
          value={other}
          onChange={setOther}
          prefer={["Income"]}
          disabled={!manage}
          create={create}
        />
      </div>
      <div className="field">
        <span className="field-label">Rewards points come from</span>
        <AccountPicker
          label="Rewards points come from"
          accounts={names}
          value={rewards}
          onChange={setRewards}
          prefer={["Income"]}
          disabled={!manage}
          create={create}
        />
      </div>
      <p className="small muted">
        Blank: as gift cards and other payments. A part of a charge paid other than by card comes
        from these, so the bank&apos;s amount still balances.
      </p>
      <fieldset className="amazon-cards">
        <legend>Which charges are this book&apos;s</legend>
        <p className="small muted">
          By the card each was paid with: only the cards marked Include (every card, if none is),
          and never one marked Exclude. A charge paid with no card at all (a gift card or points) is
          always kept. Cards show up here once a sync has seen them; to choose before the first one,
          add a card by its last four.
        </p>
        {choices.size > 0 && (
          <ul>
            {[...choices.keys()].map((last4) => {
              const card = c.cards.find((x) => x.last4 === last4);
              const label = card?.label ?? `Card ending ${last4}`;
              return (
                <li key={last4}>
                  <span>
                    {label}
                    {card && (
                      <span className="small muted">
                        {" "}
                        · {card.charges} {card.charges === 1 ? "charge" : "charges"}
                        {card.last_seen && `, latest ${formatFullDay(card.last_seen)}`}
                      </span>
                    )}
                  </span>
                  <select
                    aria-label={label}
                    value={choices.get(last4)}
                    disabled={!manage}
                    onChange={(e) => choose(last4, e.target.value as Choice)}
                  >
                    <option value="">—</option>
                    <option value="include">Include</option>
                    <option value="exclude">Exclude</option>
                  </select>
                </li>
              );
            })}
          </ul>
        )}
        {manage && (
          <div className="amazon-card-add">
            <input
              inputMode="numeric"
              aria-label="Card's last four"
              placeholder="Card's last four"
              value={newCard}
              onChange={(e) => setNewCard(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCard())}
            />
            <button type="button" onClick={addCard}>
              Add a card
            </button>
          </div>
        )}
      </fieldset>
      {message && <p className={message.kind}>{message.text}</p>}
      {manage && (
        <div className="actions">
          {c.updated_at && (
            <button type="button" onClick={() => void forget()}>
              Forget
            </button>
          )}
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      )}
    </form>
  );
}

const STATUS: Record<AmazonConnection["status"], string> = {
  new: "Not synced yet",
  ok: "Synced",
  login: "Amazon didn't let it log in",
  failed: "The last sync failed",
};

function Sync({
  book,
  connection: c,
  write,
}: {
  book: string;
  connection: AmazonConnection;
  write: boolean;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const sync = useQuery({
    queryKey: keys.sync(book),
    queryFn: () => shopsApi.syncState(book),
    refetchInterval: (query) => (query.state.data?.state === "running" ? 1500 : false),
  });
  const running = sync.data?.state === "running";
  // Once a sync finishes: what it read, and the connection's status.
  const was = useRef(running);
  useEffect(() => {
    if (was.current && !running) {
      void client.invalidateQueries({ queryKey: keys.charges(book) });
      void client.invalidateQueries({ queryKey: keys.amazon(book), exact: true });
    }
    was.current = running;
  }, [running, book, client]);
  const start = async () => {
    setError(null);
    try {
      client.setQueryData(keys.sync(book), await shopsApi.sync(book));
    } catch (e) {
      setError(explain(e));
    }
  };
  const ready = !!c.email && c.has_password;
  return (
    <section className="card" aria-label="Sync">
      <h2 className="section-title">Sync</h2>
      <p>
        <strong>{STATUS[c.status]}</strong>
        {c.last_sync_at && <span className="muted"> · last {formatWhen(c.last_sync_at)}</span>}
      </p>
      {c.status_detail && (
        <p className={`small ${c.status === "ok" ? "muted" : "error"}`}>{c.status_detail}</p>
      )}
      {running && <p className="small">{sync.data?.step}</p>}
      {sync.data?.state === "failed" && sync.data.error !== c.status_detail && (
        <p className="small error">{sync.data.error}</p>
      )}
      {error && <p className="small error">{error}</p>}
      {write && (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!ready || running}
            title={ready ? undefined : "Set the email and password first"}
            onClick={() => void start()}
          >
            {running ? "Syncing…" : "Sync now"}
          </button>
        </div>
      )}
    </section>
  );
}

const TOTALS: [string, string][] = [
  ["subtotal", "Items"],
  ["shipping_total", "Shipping"],
  ["free_shipping", "Free shipping"],
  ["promotion_applied", "Promotions"],
  ["coupon_savings", "Coupons"],
  ["subscription_discount", "Subscribe & Save"],
  ["multibuy_discount", "Multibuy"],
  ["amazon_discount", "Amazon discount"],
  ["gift_wrap", "Gift wrap"],
  ["total_before_tax", "Before tax"],
  ["estimated_tax", "Tax"],
  ["gift_card", "Gift card"],
  ["reward_points", "Rewards points"],
  ["grand_total", "Order total"],
  ["refund_total", "Refunded"],
];

const usd = (amount: string) => formatAmount(Number(amount), "USD", true);

function Charges({ book }: { book: string }) {
  const charges = useQuery({ queryKey: keys.charges(book), queryFn: () => shopsApi.charges(book) });
  if (charges.error) return <p className="card error">{explain(charges.error)}</p>;
  if (!charges.data) return null;
  const perOrder = new Map<string, number>();
  for (const c of charges.data)
    if (c.order_number) perOrder.set(c.order_number, (perOrder.get(c.order_number) ?? 0) + 1);
  return (
    <section className="card" aria-label="Charges">
      <h2 className="section-title">Charges read ({charges.data.length})</h2>
      {charges.data.length === 0 && <p className="muted">None yet: Sync now reads them.</p>}
      <ul className="amazon-charges">
        {charges.data.map((c) => (
          <Charge key={c.id} charge={c} of={perOrder.get(c.order_number ?? "") ?? 1} />
        ))}
      </ul>
    </section>
  );
}

function Charge({ charge: c, of }: { charge: AmazonCharge; of: number }) {
  const refund = Number(c.amount) > 0;
  const order = c.order;
  const link = amazonUrl(c.order_link ?? order?.link ?? null);
  return (
    <li className="amazon-charge">
      <details>
        <summary>
          <span className="amazon-charge-date">{formatFullDay(c.date)}</span>
          <span className="amazon-charge-what">
            {order?.items.length
              ? order.items.map((i) => i.title).join(" · ")
              : c.order_number
                ? `Order ${c.order_number}`
                : (c.seller ?? "No order")}
            <span className="small muted">
              {" "}
              {c.payment_method ?? "?"}
              {of > 1 ? ` · one of ${of} charges for this order` : ""}
            </span>
          </span>
          <span className="amazon-charge-amount">
            {refund ? `+${usd(c.amount)} refund` : usd(c.amount.replace(/^-/, ""))}
          </span>
        </summary>
        <div className="amazon-order small">
          {c.order_number && (
            <p>
              Order{" "}
              {link ? (
                <a href={link} target="_blank" rel="noreferrer">
                  {c.order_number}
                </a>
              ) : (
                c.order_number
              )}
              {order?.placed && `, placed ${formatFullDay(order.placed)}`}
              {order?.cancelled && " (cancelled)"}
            </p>
          )}
          {!order && c.order_number && <p className="muted">Its order hasn&apos;t been read.</p>}
          {order && (
            <>
              <ul>
                {order.items.map((i, n) => (
                  <li key={n}>
                    {i.quantity && i.quantity > 1 ? `${i.quantity} × ` : ""}
                    {amazonUrl(i.link) ? (
                      <a href={amazonUrl(i.link)!} target="_blank" rel="noreferrer">
                        {i.title}
                      </a>
                    ) : (
                      i.title
                    )}
                    {i.price && ` · ${usd(i.price)}`}
                  </li>
                ))}
              </ul>
              <p className="muted">
                {TOTALS.filter(([k]) => order.totals[k] !== null && order.totals[k] !== undefined)
                  .map(([k, label]) => `${label} ${usd(order.totals[k]!)}`)
                  .join(" · ")}
              </p>
              {order.shipments.length > 1 && (
                <p className="muted">{order.shipments.length} shipments</p>
              )}
              {order.parse_failures.length > 0 && (
                <p className="error">Couldn&apos;t read: {order.parse_failures.join("; ")}</p>
              )}
            </>
          )}
        </div>
      </details>
    </li>
  );
}
