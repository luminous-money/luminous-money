import { Link } from "wouter";

import type { CategoryRule } from "../lib/appApi.js";
import { shortName } from "../lib/accounts.js";
import { explain, useCategorizers, useRules } from "../lib/queries.js";

/** A rule's conditions in words: "contains "cafe", in Checking, at most -1.00". */
export function conditionsInWords(rule: Pick<CategoryRule, "conditions">): string {
  const c = rule.conditions;
  return [
    c.key && `payee like "${c.key}"`,
    c.contains && `contains "${c.contains}"`,
    c.account && `in ${shortName(c.account)}`,
    c.min && `at least ${c.min}`,
    c.max && `at most ${c.max}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Categorization rules: each one's conditions, its category, and how often it has applied; then
 * how often each categorizer's proposals were accepted unchanged, in the order they run.
 */
export function Rules({ book }: { book: string }) {
  const rules = useRules(book);
  const categorizers = useCategorizers(book);

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>Rules</h1>
          <p className="muted">How imported transactions are categorized</p>
        </div>
        <Link href={`/books/${book}/rules/new`} className="button primary-link">
          New rule
        </Link>
      </header>

      {rules.isPending && <p className="muted">Loading…</p>}
      {rules.error && <p className="card error">{explain(rules.error)}</p>}
      {rules.data?.length === 0 && (
        <p className="card done">
          No rules yet. History categorizes on its own; make a rule with "Remember as a rule…" in
          review, or here.
        </p>
      )}
      <section className="stack" aria-label="Your rules">
        {rules.data?.map((r) => (
          <Link key={r.id} href={`/books/${book}/rules/${r.id}`} className="card link account-card">
            <div className="account-card-top">
              <h2>{r.name}</h2>
              <span className="muted small">{shortName(r.account)}</span>
            </div>
            <p className="muted small">
              {conditionsInWords(r)}
              {r.payee && ` · payee ${r.payee}`}
              {r.auto_confirm && " · confirms automatically"}
              {` · applied ${r.applied} time${r.applied === 1 ? "" : "s"}`}
            </p>
          </Link>
        ))}
      </section>

      {categorizers.data && (
        <section className="card" aria-label="Categorizers">
          <h2 className="section-title">Categorizers, in the order they run</h2>
          <ol className="upcoming">
            {categorizers.data.map((c) => (
              <li key={c.name}>
                <span>{c.name}</span>
                <span className="muted small">
                  {c.settled
                    ? `${Math.round((c.accepted / c.settled) * 100)}% accepted`
                    : "nothing confirmed yet"}
                </span>
                <span className="muted small num">{c.settled} confirmed</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
