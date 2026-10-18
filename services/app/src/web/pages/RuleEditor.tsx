import { useState } from "react";
import { Link, useLocation } from "wouter";

import { partOf } from "../../shared/divided.js";
import { payeeKey } from "../../shared/payees.js";
import { AccountPicker } from "../components/AccountPicker.js";
import { displayName, postable, shortName } from "../lib/accounts.js";
import type { CategoryRule, CategoryRuleIn } from "../lib/appApi.js";
import { isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { useBack, useParam } from "../lib/navigation.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useApplyRule,
  useDeleteRule,
  useRule,
  useSaveRule,
  useTransaction,
} from "../lib/queries.js";
import { simple } from "../lib/split.js";

const BLANK: CategoryRuleIn = {
  name: "",
  conditions: { account: null, key: null, contains: null, min: null, max: null },
  account: "",
  payee: null,
  part: null,
  auto_confirm: false,
};

/** A new rule (blank, or from `?from=<transaction>`: "Remember as a rule…"), or an existing
 * one. After saving, offers to re-apply it to the unconfirmed transactions it covers. */
export function RuleEditor({ book, id }: { book: string; id?: string }) {
  const from = useParam("from");
  const existing = useRule(book, id);
  const source = useTransaction(book, from ?? "");
  const accounts = useAccounts(book);
  const back = useBack(`/books/${book}/rules`);
  const loading = (id && existing.isPending) || (from && (source.isPending || accounts.isPending));

  let initial: CategoryRuleIn = existing.data ?? BLANK;
  const t = source.data;
  const view = t && simple(t);
  if (!existing.data && t && view) {
    const key = payeeKey(t.narration || t.payee || "");
    // A part of a divided account (M15): the rule matches the whole, and lands in that part.
    const whole = accounts.data && partOf(accounts.data, view.anchor.account);
    const main = accounts.data?.find((a) => a.name === whole)?.main_part;
    initial = {
      name: t.payee || key || "New rule",
      conditions: { ...BLANK.conditions, account: whole ?? view.anchor.account, key: key || null },
      account: view.counterpart.account,
      payee: t.payee ?? null,
      part: whole && view.anchor.account !== main ? view.anchor.account : null,
      auto_confirm: false,
    };
  }

  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>{id ? "Edit rule" : "New rule"}</h1>
      </header>
      {loading && <p className="muted">Loading…</p>}
      {existing.error && <p className="card error">{explain(existing.error)}</p>}
      {!loading && (
        <Form
          key={existing.data?.updated_at ?? t?.id ?? "new"}
          book={book}
          rule={existing.data}
          initial={initial}
          back={back}
        />
      )}
    </main>
  );
}

function Form({
  book,
  rule,
  initial,
  back,
}: {
  book: string;
  rule?: CategoryRule;
  initial: CategoryRuleIn;
  back: string;
}) {
  const [, navigate] = useLocation();
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const save = useSaveRule(book);
  const remove = useDeleteRule(book);
  const apply = useApplyRule(book);
  const [name, setName] = useState(initial.name);
  const [account, setAccount] = useState(initial.conditions.account ?? "");
  const [key, setKey] = useState(initial.conditions.key ?? "");
  const [contains, setContains] = useState(initial.conditions.contains ?? "");
  const [min, setMin] = useState(initial.conditions.min ?? "");
  const [max, setMax] = useState(initial.conditions.max ?? "");
  const [category, setCategory] = useState(initial.account);
  const [payee, setPayee] = useState(initial.payee ?? "");
  const [part, setPart] = useState(initial.part ?? "");
  const [autoConfirm, setAutoConfirm] = useState(initial.auto_confirm);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; covers: number } | null>(null);
  const leaves = accounts.data ? postable(accounts.data, today()) : [];
  const chart = accounts.data ?? [];
  // What can be imported into: open asset and liability leaves, and divided accounts (M15),
  // whose parts are chosen with "Lands in".
  const importable = chart
    .filter(
      (a) =>
        (a.type === "asset" || a.type === "liability") &&
        !a.close &&
        ((a.kind === "leaf" && !a.implicit && !partOf(chart, a.name)) || a.divided)
    )
    .map((a) => a.name);
  const whole = chart.find((a) => a.name === account && a.divided);
  const parts = whole
    ? chart.filter((a) => a.name.startsWith(`${whole.name}:`) && a.kind === "leaf" && !a.close)
    : [];

  const conditions = {
    account: account || null,
    key: key.trim() || null,
    contains: contains.trim() || null,
    min: min.trim() || null,
    max: max.trim() || null,
  };
  const problem = !name.trim()
    ? "Name the rule"
    : !Object.values(conditions).some(Boolean)
      ? "Give the rule at least one condition"
      : [conditions.min, conditions.max].some((v) => v && !isDecimal(v))
        ? "Amounts are numbers, like -25.00"
        : !category
          ? "Choose the category"
          : null;

  const submit = async () => {
    setError(null);
    const body = {
      name,
      conditions,
      account: category,
      payee: payee.trim() || null,
      part: (whole && part) || null,
      auto_confirm: autoConfirm,
    };
    try {
      const result = await save.mutateAsync(
        rule ? { id: rule.id, rule: { ...body, updated_at: rule.updated_at } } : { rule: body }
      );
      if (result.covers > 0) setSaved({ id: result.id, covers: result.covers });
      else navigate(back);
    } catch (e) {
      setError(explain(e));
    }
  };

  if (saved) {
    return (
      <section className="card stack" aria-label="Apply the rule">
        <p>
          Saved. It covers {saved.covers} unconfirmed transaction{saved.covers === 1 ? "" : "s"} not
          yet decided. Categorize {saved.covers === 1 ? "it" : "them"} as {shortName(category)} now?
        </p>
        <div className="actions">
          <button type="button" onClick={() => navigate(back)}>
            Not now
          </button>
          <button
            type="button"
            className="primary"
            disabled={apply.isPending}
            onClick={async () => {
              await apply.mutateAsync(saved.id);
              navigate(back);
            }}
          >
            Apply to {saved.covers}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="editor" onSubmit={(e) => (e.preventDefault(), !problem && void submit())}>
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coffee shops"
        />
      </label>

      <fieldset className="rule">
        <legend>When a transaction…</legend>
        <label>
          Is imported into <span className="muted">(optional)</span>
          <select
            aria-label="Imported into"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Any account</option>
            {importable.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {whole && (
          <label>
            Lands in
            <select aria-label="Lands in" value={part} onChange={(e) => setPart(e.target.value)}>
              <option value="">
                {displayName(chart.find((a) => a.name === whole.main_part) ?? { name: "" }) ||
                  "Its main part"}{" "}
                (where new money lands)
              </option>
              {parts
                .filter((p) => p.name !== whole.main_part)
                .map((p) => (
                  <option key={p.name} value={p.name}>
                    {displayName(p)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Has the payee key <span className="muted">(optional)</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. corner cafe chicago"
          />
        </label>
        <label>
          Its description contains <span className="muted">(optional)</span>
          <input
            value={contains}
            onChange={(e) => setContains(e.target.value)}
            placeholder="e.g. cafe"
          />
        </label>
        <div className="pair">
          <label>
            Amount at least
            <input
              inputMode="decimal"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              placeholder="-100.00"
            />
          </label>
          <label>
            Amount at most
            <input
              inputMode="decimal"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              placeholder="-1.00"
            />
          </label>
        </div>
        <p className="muted small">Money out is negative. A rule needs at least one condition.</p>
      </fieldset>

      <fieldset className="rule">
        <legend>…categorize it as</legend>
        <AccountPicker
          label="Category"
          accounts={leaves}
          value={category}
          create={create}
          onChange={setCategory}
        />
        <label>
          Payee <span className="muted">(optional)</span>
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="e.g. Corner Cafe"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
          />
          Confirm automatically (no review needed)
        </label>
      </fieldset>

      {(error || problem) && <p className={error ? "error" : "muted small"}>{error ?? problem}</p>}

      <div className="actions pinned">
        <Link href={back} className="button">
          Back
        </Link>
        {rule && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={async () => {
              if (!window.confirm(`Delete the rule "${rule.name}"?`)) return;
              try {
                await remove.mutateAsync(rule);
                navigate(back);
              } catch (e) {
                setError(explain(e));
              }
            }}
          >
            Delete
          </button>
        )}
        <button type="submit" className="primary" disabled={!!problem || save.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}
