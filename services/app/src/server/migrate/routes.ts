/**
 * Migrating from another system: `/books/:book/migration` (docs/milestones/migrate-from-another-system).
 * Reading it is any member's; everything else a manager's, since it sets up the book's AI and
 * rules as well as its accounts. The history is kept (once it's read, mapped); the files
 * uploaded aren't: the chart is planned (and added) from its text each time.
 */
import type { Context, Hono } from "hono";

import { batchOrder, planChart, type ChartChoice, type ChartPlan } from "../../shared/chart.js";
import type { CategoryRule } from "../../shared/rules.js";
import { LedgerError, type LedgerPort } from "../ledger.js";
import { openToCategorizing } from "../categorize/service.js";
import { CONTEXT_MONTHS, monthsBefore } from "../categorize/context.js";
import { readGnucashHistory } from "./gnucash.js";
import { seenFrom } from "./history.js";
import { buildReference, seenInBook, suggestRules, type Entry } from "./reference.js";
import {
  SOURCES,
  STEPS,
  StaleMigration,
  type MigrationState,
  type Source,
  type Step,
} from "./store.js";
import { startSuggesting, uncategorized, type SuggestDeps } from "./suggest.js";

type Env = { Variables: { user: string } };

export type MigrationDeps = SuggestDeps & {
  roleIn: (user: string, book: string) => Promise<string | undefined>;
};

const RANKS = ["read", "write", "manage", "owner"];
const atLeast = (role: string | undefined, need: string) =>
  role !== undefined && RANKS.indexOf(role) >= RANKS.indexOf(need);
const today = () => new Date().toISOString().slice(0, 10);

/** What a page may say about a step it handled itself (the rest, routes record). */
const OWN = {
  bank: ["done", "skipped"],
  ai: ["done", "skipped"],
  rules: ["skipped"],
  suggest: ["skipped"],
} as const;

/** The reference as it is now: the imported history and the last 14 months of the book's own. */
async function referenceNow(deps: MigrationDeps, ledger: LedgerPort, book: string) {
  const [accounts, own] = await Promise.all([
    ledger.accounts(book),
    ledger.compact(book, monthsBefore(today(), CONTEXT_MONTHS)),
  ]);
  const sides = new Set(
    accounts.filter((a) => a.type === "asset" || a.type === "liability").map((a) => a.name)
  );
  const leaves = new Set(
    accounts.filter((a) => a.kind === "leaf" && !a.implicit && !a.close).map((a) => a.name)
  );
  const imported = deps.migrations.history(book);
  const reference = buildReference(
    [
      ...seenFrom(imported),
      ...seenInBook(
        own.map((t) => ({
          ...t,
          payee: t.payee ?? null,
          narration: t.narration ?? null,
          postings: t.postings.map((p) => ({ account: p.account, amount: p.amount ?? null })),
        }))
      ),
    ],
    {
      today: today(),
      balanceSheet: (a) => sides.has(a) || /^(Assets|Liabilities):/.test(a),
      usable: (a) => leaves.has(a),
    }
  );
  return { reference, imported, accounts };
}

const view = (e: Entry) => ({
  payee: e.payee,
  seen: e.seen,
  last: e.last,
  accounts: e.accounts.slice(0, 3),
});

export function migrationRoutes(api: Hono<Env>, deps: MigrationDeps) {
  const { db, migrations, ledgerFor } = deps;

  /** Null for a manager of the book; else the response saying why not. */
  const refusal = async (c: Context<Env>, book: string) => {
    const role = await deps.roleIn(c.get("user"), book);
    if (!role) return c.json({ detail: "not found" }, 404);
    if (!atLeast(role, "manage"))
      return c.json({ detail: "only the book's managers can migrate it" }, 403);
    return null;
  };
  const body = async <T>(c: { req: { json(): Promise<unknown> } }) =>
    ((await c.req.json().catch(() => null)) ?? {}) as Partial<T>;

  api.get("/books/:book/migration", async (c) => {
    const { book } = c.req.param();
    if (!(await deps.roleIn(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json({ migration: migrations.migration(book) ?? null });
  });

  api.post("/books/:book/migration", async (c) => {
    const { book } = c.req.param();
    const refused = await refusal(c, book);
    if (refused) return refused;
    const { source = "gnucash" } = await body<{ source: Source }>(c);
    if (!SOURCES.includes(source))
      return c.json({ detail: `from one of ${SOURCES.join(", ")}` }, 422);
    return c.json(migrations.start(book, c.get("user"), source), 201);
  });

  /** The page's own changes: its step, done, and what it did itself (bank feeds and the AI set
   * up or skipped, the reference on or off, rules or suggestions skipped). Versioned. */
  api.patch("/books/:book/migration", async (c) => {
    const { book } = c.req.param();
    const refused = await refusal(c, book);
    if (refused) return refused;
    if (!migrations.migration(book)) return c.json({ detail: "not found" }, 404);
    const input = await body<{ updated_at: string; step: Step; done: boolean } & MigrationState>(c);
    if (typeof input.updated_at !== "string") return c.json({ detail: "send updated_at" }, 422);
    if (input.step !== undefined && !STEPS.includes(input.step))
      return c.json({ detail: `the step is one of ${STEPS.join(", ")}` }, 422);
    const state: Partial<MigrationState> = {};
    for (const [key, allowed] of Object.entries(OWN) as [keyof typeof OWN, readonly string[]][])
      if (key in input) {
        if (!allowed.includes(input[key] as string))
          return c.json({ detail: `${key} is one of ${allowed.join(", ")}` }, 422);
        Object.assign(state, { [key]: input[key] });
      }
    if ("reference" in input) state.reference = !!input.reference;
    try {
      return c.json(
        migrations.update(
          book,
          {
            ...(input.step ? { step: input.step } : {}),
            ...(input.done !== undefined ? { done: !!input.done } : {}),
            state,
          },
          input.updated_at
        )
      );
    } catch (error) {
      if (error instanceof StaleMigration)
        return c.json({ detail: "This changed somewhere else; it's been reloaded." }, 409);
      throw error;
    }
  });

  /** The chart, planned against the book: `{text, include_hidden, choices}`. */
  const planned = async (
    c: { req: { json(): Promise<unknown> } },
    ledger: LedgerPort,
    book: string
  ): Promise<ChartPlan | null> => {
    const input = await body<{
      text: string;
      include_hidden: boolean;
      choices: Record<string, ChartChoice>;
    }>(c);
    if (typeof input.text !== "string") return null;
    const info = await ledger.book(book);
    return planChart(input.text, await ledger.accounts(book), info?.currency ?? "USD", {
      includeHidden: !!input.include_hidden,
      choices: input.choices ?? {},
    });
  };

  api.post("/books/:book/migration/accounts/preview", async (c) => {
    const { book } = c.req.param();
    const refused = await refusal(c, book);
    if (refused) return refused;
    const plan = await planned(c, ledgerFor(c.get("user")), book);
    return plan ? c.json(plan) : c.json({ detail: "send the chart's text" }, 422);
  });

  /** Add the chart's accounts (all or none), and keep its mapping for the history. */
  api.post("/books/:book/migration/accounts", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    const refused = await refusal(c, book);
    if (refused) return refused;
    if (!migrations.migration(book)) return c.json({ detail: "start the migration first" }, 404);
    const ledger = ledgerFor(user);
    const plan = await planned(c, ledger, book);
    if (!plan) return c.json({ detail: "send the chart's text" }, 422);
    if (plan.error) return c.json({ detail: plan.error }, 422);
    try {
      if (plan.add.length) await ledger.createAccounts(book, batchOrder(plan.add));
    } catch (error) {
      if (error instanceof LedgerError && [409, 422].includes(error.status))
        return c.json({ detail: error.message }, error.status as 409 | 422);
      throw error;
    }
    const migration = migrations.update(book, {
      step: "history",
      state: {
        accounts: {
          added: plan.add.length,
          existing: plan.existing.length,
          left: plan.left.length,
          problems: plan.problems.length,
        },
        mapping: { ...migrations.migration(book)!.state.mapping, ...plan.mapping },
      },
    });
    return c.json({ migration, plan });
  });

  /** Read the other system's history (`{text}`), mapped, as the book's imported history. */
  api.post("/books/:book/migration/history", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    const refused = await refusal(c, book);
    if (refused) return refused;
    const current = migrations.migration(book);
    if (!current) return c.json({ detail: "start the migration first" }, 404);
    const { text } = await body<{ text: string }>(c);
    if (typeof text !== "string") return c.json({ detail: "send the history's text" }, 422);
    const accounts = await ledgerFor(user).accounts(book);
    const read = readGnucashHistory(text, {
      mapping: current.state.mapping ?? {},
      roots: accounts.filter((a) => !a.name.includes(":")).map((a) => a.name),
    });
    if (read.error) return c.json({ detail: read.error }, 422);
    migrations.replaceHistory(book, read.transactions);
    const dates = read.transactions.map((t) => t.date).sort();
    const migration = migrations.update(book, {
      step: "bank",
      state: {
        history: {
          transactions: read.transactions.length,
          from: dates[0] ?? null,
          to: dates.at(-1) ?? null,
          problems: read.problems.length,
          voided: read.voided,
          unmapped: Object.keys(read.unmapped).length,
        },
      },
    });
    return c.json({
      migration,
      problems: read.problems.slice(0, 20),
      unmapped: read.unmapped,
    });
  });

  /** The reference as it is now: how much it's made of, and its weightiest payees. */
  api.get("/books/:book/migration/reference", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await deps.roleIn(user, book))) return c.json({ detail: "not found" }, 404);
    const { reference, imported } = await referenceNow(deps, ledgerFor(user), book);
    return c.json({
      imported: imported.length,
      from: imported[0]?.date ?? null,
      to: imported.at(-1)?.date ?? null,
      payees: reference.length,
      top: reference.slice(0, 15).map(view),
    });
  });

  /** Rules worth making, from the reference. */
  api.get("/books/:book/migration/rules", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await deps.roleIn(user, book))) return c.json({ detail: "not found" }, 404);
    const ledger = ledgerFor(user);
    const { reference } = await referenceNow(deps, ledger, book);
    const waiting = (await uncategorized(ledger, book)).flatMap((t) => openToCategorizing(t) ?? []);
    return c.json(suggestRules(reference, db.rules(book), waiting));
  });

  /** Make the rules chosen (`{rules: [{key, match, account, payee}]}`): each a payee's key (or
   * a description containing it) to its account, named for the payee. */
  api.post("/books/:book/migration/rules", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    const refused = await refusal(c, book);
    if (refused) return refused;
    if (!migrations.migration(book)) return c.json({ detail: "start the migration first" }, 404);
    const { rules = [] } = await body<{
      rules: { key: string; match?: "key" | "contains"; account: string; payee: string }[];
    }>(c);
    const accounts = await ledgerFor(user).accounts(book);
    const leaves = new Set(
      accounts.filter((a) => a.kind === "leaf" && !a.implicit && !a.close).map((a) => a.name)
    );
    const have = new Set(
      db.rules(book).flatMap((r: CategoryRule) => [r.conditions.key, r.conditions.contains])
    );
    const usable = rules.filter(
      (r) => r?.key && typeof r.key === "string" && leaves.has(r.account) && !have.has(r.key)
    );
    for (const r of usable)
      db.addRule(book, {
        name: String(r.payee || r.key).slice(0, 100),
        conditions: {
          account: null,
          key: r.match === "contains" ? null : r.key,
          contains: r.match === "contains" ? r.key : null,
          min: null,
          max: null,
        },
        account: r.account,
        payee: null,
        auto_confirm: false,
      });
    const migration = migrations.update(book, {
      step: "suggest",
      state: { rules: { added: usable.length } },
    });
    return c.json({ migration, added: usable.length });
  });

  /** How many are waiting to be suggested for: what's still uncategorized. */
  api.get("/books/:book/migration/uncategorized", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await deps.roleIn(user, book))) return c.json({ detail: "not found" }, 404);
    return c.json({ count: (await uncategorized(ledgerFor(user), book)).length });
  });

  /** Suggest categories for everything uncategorized, in the background. */
  api.post("/books/:book/migration/suggest", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    const refused = await refusal(c, book);
    if (refused) return refused;
    if (!migrations.migration(book)) return c.json({ detail: "start the migration first" }, 404);
    if (!startSuggesting(deps, user, book))
      return c.json({ detail: "it's suggesting already" }, 409);
    return c.json(migrations.migration(book), 202);
  });
}
