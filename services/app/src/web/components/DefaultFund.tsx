/**
 * An account's default fund (Funds B): from a day, what changes in the account (and under it) with
 * no line saying otherwise is that fund's. Kael's IRAs are Retirement's this way. Shown in an asset
 * or liability account's editor and beside a linked bank account; set by managers, from the
 * account's opening (it gets everything in it now) or another day, saying what it will do before
 * it's saved.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { UNALLOCATED } from "../../shared/funds.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { formatDay, today } from "../lib/format.js";
import { signedMoney } from "../lib/funds.js";
import { api, type FundDefault } from "../lib/ledger.js";
import {
  explain,
  useAccounts,
  useCanManage,
  useCreateDefault,
  useDeleteDefault,
  useFunds,
  usePatchDefault,
} from "../lib/queries.js";

const NONE = "";

/** A default's fund in words. */
const named = (d: Pick<FundDefault, "fund">) => d.fund ?? "None of its own";

export function DefaultFundCard({
  book,
  account,
  opened: given,
  bare = false,
}: {
  book: string;
  account: string;
  /** When the account opened: a default from then gets everything in it. */
  opened?: string | null;
  /** Inside something else (a linked bank account): no card or heading of its own. */
  bare?: boolean;
}) {
  const listing = useFunds(book).data;
  const accounts = useAccounts(book).data;
  const opened = given ?? accounts?.find((a) => a.name === account)?.open ?? null;
  const canManage = useCanManage(book);
  const create = useCreateDefault(book);
  const patch = usePatchDefault(book);
  const remove = useDeleteDefault(book);
  const mine = (listing?.defaults ?? [])
    .filter((d) => d.account === account)
    .sort((a, b) => a.date.localeCompare(b.date));
  const current = mine.filter((d) => d.date <= today()).at(-1);
  const active = listing?.funds.filter((f) => !f.archived) ?? [];
  const [fund, setFund] = useState<string | null>(null);
  const [picked, setDate] = useState<string | null>(null);
  const date = picked ?? opened ?? today();
  const [error, setError] = useState<string | null>(null);
  const chosen = fund ?? current?.fund ?? NONE;
  const same = mine.find((d) => d.date === date);
  const changing =
    fund !== null && (fund || null) !== (same?.fund ?? (same ? null : (current?.fund ?? null)));
  const preview = useQuery({
    queryKey: ["book", book, "funds", "default-preview", account, chosen, date, same?.id],
    queryFn: () =>
      api.previewDefault(book, {
        id: same?.id ?? null,
        account,
        fund: chosen || null,
        date,
        delete: false,
      }),
    enabled: changing,
  });
  if (!listing || (!active.length && !mine.length)) return null;
  const busy = create.isPending || patch.isPending || remove.isPending;

  const save = async () => {
    setError(null);
    try {
      if (same)
        await patch.mutateAsync({
          id: same.id,
          patch: { updated_at: same.updated_at, fund: chosen || null },
        });
      else await create.mutateAsync({ account, fund: chosen || null, date });
      setFund(null);
    } catch (e) {
      setError(explain(e));
    }
  };

  const effect = preview.data;
  const words = effect?.changes
    .filter((c) => c.fund !== UNALLOCATED || effect.changes.length === 1)
    .map(
      (c) =>
        `${c.fund} ${c.amounts.map((a) => signedMoney(a.number, a.currency)).join(" and ")}` +
        (c.amounts.length > 1 || c.amounts.some((a) => a.currency !== listing.currency)
          ? ` (${isNegative(c.value.number) ? "" : "+"}${formatMoney(c.value.number, c.value.currency)})`
          : "")
    )
    .join(" · ");

  return (
    <section
      className={bare ? "editor default-fund" : "card editor default-fund"}
      aria-label={`Default fund of ${account}`}
    >
      {!bare && <h2>Default fund</h2>}
      <p className="small muted">
        What changes in this account with no fund chosen is its default fund&apos;s: dividends,
        trades, money coming in or going out. Without one, it&apos;s {UNALLOCATED}&apos;s.
      </p>
      {mine.length > 0 && (
        <ul className="plain-list small default-list">
          {mine.map((d) => (
            <li key={d.id}>
              <strong>{named(d)}</strong> from {formatDay(d.date)}
              {d === current && <span className="muted"> (now)</span>}
              {canManage && (
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove the default from ${d.date}`}
                  disabled={busy}
                  onClick={async () => {
                    setError(null);
                    try {
                      await remove.mutateAsync({ id: d.id, updated_at: d.updated_at });
                    } catch (e) {
                      setError(explain(e));
                    }
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (changing && !effect?.problem) void save();
          }}
        >
          <div className="pair">
            <label>
              Fund
              <select value={chosen} onChange={(e) => setFund(e.target.value)}>
                <option value={NONE}>None</option>
                <option value={UNALLOCATED}>{UNALLOCATED}</option>
                {active.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
                {chosen && chosen !== UNALLOCATED && !active.some((f) => f.name === chosen) && (
                  <option value={chosen}>{chosen} (archived)</option>
                )}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={date}
                required
                onChange={(e) => {
                  setDate(e.target.value);
                  if (fund === null) setFund(chosen);
                }}
              />
            </label>
          </div>
          <p className="small">
            {opened && (
              <button
                type="button"
                className="plain"
                aria-pressed={date === opened}
                onClick={() => (setDate(opened), fund === null && setFund(chosen))}
              >
                Its opening ({formatDay(opened)})
              </button>
            )}{" "}
            <button
              type="button"
              className="plain"
              aria-pressed={date === today()}
              onClick={() => (setDate(today()), fund === null && setFund(chosen))}
            >
              Today
            </button>
          </p>
          {changing && (
            <p className={`small${effect?.problem ? " error" : " muted"}`} aria-live="polite">
              {preview.isPending
                ? "Working out what it does…"
                : preview.error
                  ? explain(preview.error)
                  : effect?.problem
                    ? `Can't: ${effect.problem}.`
                    : words
                      ? `From ${formatDay(date)}: ${words}.`
                      : "No fund changes."}
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button
              type="submit"
              className="primary"
              disabled={!changing || busy || preview.isPending || !!effect?.problem}
            >
              Save
            </button>
          </div>
        </form>
      ) : (
        !mine.length && <p className="small">None: it&apos;s {UNALLOCATED}&apos;s.</p>
      )}
    </section>
  );
}
