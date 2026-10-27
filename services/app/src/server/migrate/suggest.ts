/**
 * A migration's last step: suggesting categories for every unconfirmed transaction still
 * uncategorized, through the usual chain (rules, history with the imported history, and the
 * book's AI with the reference when they're on), as Suggest categories would. It can be
 * hundreds, and the AI answers 20 at a time, so it runs in the background, `CHUNK` at a time,
 * its progress kept in the migration's state for the page to show. Once at a time per book; one
 * running when the app stops is marked stopped at the next start (`MigrationStore.stopInterrupted`)
 * and can be run again.
 */
import { now } from "@luminous-money/db";

import { isUncategorized } from "../../shared/accounts.js";
import type { AppDb } from "../db.js";
import type { LedgerPort } from "../ledger.js";
import { openToCategorizing, suggestUnconfirmed } from "../categorize/service.js";
import type { Categorizer } from "../categorize/types.js";
import type { MigrationStore, SuggestJob } from "./store.js";

export const CHUNK = 40;

export type SuggestDeps = {
  db: AppDb;
  migrations: MigrationStore;
  ledgerFor: (user: string) => LedgerPort;
  chainFor: (
    user: string,
    book: string,
    currency: string
  ) => Promise<{ categorizers: Categorizer[]; ai: boolean; error: () => string | null }>;
};

const running = new Set<string>();

/** The unconfirmed transactions with a split still uncategorized. */
export async function uncategorized(ledger: LedgerPort, book: string) {
  return (await ledger.unconfirmed(book)).filter((t) => {
    const incoming = openToCategorizing(t);
    return !!incoming && t.postings.slice(1).some((p) => isUncategorized(p.account));
  });
}

/** Start suggesting in the background, unless it's already running; false if it was. */
export function startSuggesting(deps: SuggestDeps, user: string, book: string): boolean {
  if (running.has(book)) return false;
  running.add(book);
  void run(deps, user, book).finally(() => running.delete(book));
  return true;
}

async function run(deps: SuggestDeps, user: string, book: string): Promise<void> {
  const { db, migrations } = deps;
  const ledger = deps.ledgerFor(user);
  let job: SuggestJob = {
    status: "running",
    total: 0,
    done: 0,
    suggested: 0,
    ai: false,
    ai_error: null,
    error: null,
    started_at: now(),
    finished_at: null,
  };
  const save = (changes: Partial<SuggestJob>) => {
    job = { ...job, ...changes };
    migrations.update(book, { state: { suggest: job } });
  };
  save({});
  try {
    const info = await ledger.book(book);
    if (!info) throw new Error("the book is gone");
    const ids = (await uncategorized(ledger, book)).map((t) => t.id);
    const chain = await deps.chainFor(user, book, info.currency ?? "USD");
    save({ total: ids.length, ai: chain.ai });
    for (let i = 0; i < ids.length; i += CHUNK) {
      const suggested = await suggestUnconfirmed({
        db,
        ledger,
        book: { id: info.id, name: info.name },
        categorizers: chain.categorizers,
        ids: ids.slice(i, i + CHUNK),
      });
      save({
        done: Math.min(ids.length, i + CHUNK),
        suggested: job.suggested + suggested,
        ai_error: chain.error(),
      });
    }
    save({ status: "done", finished_at: now() });
  } catch (error) {
    save({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finished_at: now(),
    });
  }
}
