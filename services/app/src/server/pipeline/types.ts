/**
 * The processing pipeline's contract (docs/design.md, "The resolver pipeline").
 *
 * A batch of incoming transactions goes through a chain of resolvers. Each looks at the batch
 * with its context and resolves what it can; M4 will add categorizers after the matcher. In M1
 * the only resolver is the matcher, and it only identifies and ranks candidates: it annotates
 * rows without claiming them, so nothing acts on matches yet.
 */
import type { Candidate } from "../../shared/imports.js";

export type { Candidate } from "../../shared/imports.js";

export type Incoming = {
  /** Where it came from in its batch (for a CSV, the file's line). */
  line: number;
  date: string;
  /** The account's change: positive is money in. */
  amount: { number: string; currency: string };
  description: string;
  payee: string | null;
};

/** An existing transaction in the account, as the account's ledger shows it. */
export type Existing = {
  id: string;
  date: string;
  flag: string;
  payee: string | null;
  narration: string | null;
  amount: { number: string; currency: string } | null;
};

export type Context = {
  account: string;
  /** The account's transactions around the batch's dates. */
  existing: Existing[];
};

export type Resolution = {
  line: number;
  resolver: string;
  /** Existing transactions that might be the same event, best first. */
  candidates: Candidate[];
  /** Whether this settles the row, so later resolvers skip it. The M1 matcher never does. */
  final: boolean;
};

export interface Resolver {
  name: string;
  resolve(batch: Incoming[], context: Context): Resolution[] | Promise<Resolution[]>;
}
