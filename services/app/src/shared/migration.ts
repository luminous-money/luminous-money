/**
 * Migrating a book from another system (docs/milestones/migrate-from-another-system): its steps
 * and what each did, as the server keeps them and the PWA shows them.
 */
import type { PayeeReference } from "@luminous-money/ai-api";

export const STEPS = [
  "files",
  "accounts",
  "history",
  "bank",
  "ai",
  "reference",
  "rules",
  "suggest",
  "finish",
] as const;
export type Step = (typeof STEPS)[number];
export const SOURCES = ["gnucash"] as const;
export type Source = (typeof SOURCES)[number];

/** Suggesting categories for everything uncategorized, in the background. */
export type SuggestJob = {
  status: "running" | "done" | "failed" | "stopped";
  /** Transactions to go through, how many have been, and how many got a suggestion. */
  total: number;
  done: number;
  suggested: number;
  /** Whether the book's AI was asked, and why it couldn't answer if it couldn't. */
  ai: boolean;
  ai_error: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

/** What each step did (absent: not reached). */
export type MigrationState = {
  accounts?: { added: number; existing: number; left: number; problems: number };
  /** The chart's mapping, from the other system's names to this book's: for its history. */
  mapping?: Record<string, string>;
  history?: {
    transactions: number;
    from: string | null;
    to: string | null;
    problems: number;
    voided: number;
    /** Names that weren't in the chart, made into accounts' names as the chart would. */
    unmapped: number;
  };
  bank?: "done" | "skipped";
  ai?: "done" | "skipped";
  /** The AI categorizer uses the reference. */
  reference?: boolean;
  rules?: { added: number } | "skipped";
  suggest?: SuggestJob | "skipped";
};

export type Migration = {
  book_id: string;
  user_id: string;
  source: Source;
  step: Step;
  done: boolean;
  state: MigrationState;
  created_at: string;
  updated_at: string;
};

/** A rule worth making: a payee nearly always categorized one way. */
export type RuleSuggestion = {
  key: string;
  /** How the rule recognizes the payee: by its key exactly, or its description containing the
   * key (when that's what catches the bank's text for it: the old books' "Corner Cafe" in
   * "SQ *CORNER CAFE CHICAGO IL"). */
  match: "key" | "contains";
  /** The payee as last written, to name the rule. */
  payee: string;
  account: string;
  /** How often it was seen, and how often in that account. */
  seen: number;
  matched: number;
  /** How many transactions waiting now it would categorize. */
  waiting: number;
};

/** The reference as it is now: how much it's made of, and its weightiest payees. */
export type ReferenceSummary = {
  /** Imported transactions, and their first and last dates. */
  imported: number;
  from: string | null;
  to: string | null;
  payees: number;
  top: PayeeReference[];
};
