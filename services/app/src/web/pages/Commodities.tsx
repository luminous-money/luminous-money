import type { CommodityOut } from "@luminous-money/ledger-client";
import { useState } from "react";

import { formatMoney } from "../lib/decimal.js";
import {
  explain,
  useCommodities,
  useFetchPrices,
  useLastPriceFetch,
  useSetCommodity,
} from "../lib/queries.js";

/**
 * Commodities: everything held or priced (shares, funds), each with its latest price, where
 * prices are fetched from (beanprice's `USD:yahoo/VTI`), and how many days until its price is
 * stale. Prices are fetched each morning; "Fetch prices now" doesn't wait.
 */
export function Commodities({ book }: { book: string }) {
  const commodities = useCommodities(book);
  const last = useLastPriceFetch(book);
  const fetchNow = useFetchPrices(book);
  const errors = last.data?.result.errors ?? {};

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>Commodities</h1>
          <p className="muted">
            {last.data
              ? `Prices last fetched ${last.data.ran_on}`
              : "Prices are fetched each morning (books with a time zone)"}
          </p>
        </div>
        <button type="button" disabled={fetchNow.isPending} onClick={() => fetchNow.mutate()}>
          {fetchNow.isPending ? "Fetching…" : "Fetch prices now"}
        </button>
      </header>
      {fetchNow.error && <p className="card error">{explain(fetchNow.error)}</p>}
      {errors["*"] && <p className="card error">The last run failed: {errors["*"]}</p>}
      {commodities.isPending && <p className="muted">Loading…</p>}
      {commodities.data?.length === 0 && <p className="card done">Nothing but cash yet.</p>}
      <section className="stack" aria-label="Commodities">
        {commodities.data?.map((c) => (
          <CommodityCard key={c.currency} book={book} commodity={c} error={errors[c.currency]} />
        ))}
      </section>
    </main>
  );
}

function CommodityCard({
  book,
  commodity: c,
  error,
}: {
  book: string;
  commodity: CommodityOut;
  error: string | undefined;
}) {
  const save = useSetCommodity(book);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name ?? "");
  const [source, setSource] = useState(c.price_source ?? "");
  const [stale, setStale] = useState(String(c.stale_after));

  return (
    <article className="card" aria-label={c.currency}>
      <div className="account-card-top">
        <h2>
          {c.currency} {c.name && <span className="muted small">{c.name}</span>}
        </h2>
        <span className="balance">
          {c.price ? formatMoney(c.price.number, c.price.currency) : "no price"}
        </span>
      </div>
      <p className="muted small">
        {c.price_date && `as of ${c.price_date} · `}
        {c.price_source ? `fetched from ${c.price_source}` : "entered by hand"} · stale after{" "}
        {c.stale_after} days
      </p>
      {error && <p className="error small">Couldn&apos;t fetch: {error}</p>}
      {editing ? (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              {
                currency: c.currency,
                name: name.trim() || null,
                price_source: source.trim() || null,
                stale_after: Number(stale) || null,
                updated_at: c.updated_at ?? null,
              },
              { onSuccess: () => setEditing(false) }
            );
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Price source <span className="muted">(beanprice: e.g. USD:yahoo/VTI)</span>
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label>
            Stale after (days)
            <input inputMode="numeric" value={stale} onChange={(e) => setStale(e.target.value)} />
          </label>
          {save.error && <p className="error">{explain(save.error)}</p>}
          <div className="actions">
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={save.isPending}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      )}
    </article>
  );
}
