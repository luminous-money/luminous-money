import { describe, expect, it } from "vitest";

import { assign } from "./assign.js";
import { runChain } from "./chain.js";
import { matcher, sameNumber } from "./matcher.js";
import type { Candidate, Context, Existing, Incoming, Resolver } from "./types.js";

const usd = (number: string) => ({ number, currency: "USD" });
const row = (line: number, date: string, amount: string): Incoming => ({
  line,
  date,
  amount: usd(amount),
  description: "x",
  payee: null,
});
const existing = (id: string, date: string, amount: string | null, currency = "USD"): Existing => ({
  id,
  date,
  flag: "*",
  payee: null,
  narration: id,
  amount: amount === null ? null : { number: amount, currency },
});

describe("the matcher", () => {
  const context: Context = {
    account: "Assets:Bank:PNC",
    existing: [
      existing("same-day", "2024-03-10", "-4.50"),
      existing("two-later", "2024-03-12", "-4.5"),
      existing("six-earlier", "2024-03-04", "-4.50"), // outside the window
      existing("other-amount", "2024-03-10", "-4.51"),
      existing("other-currency", "2024-03-10", "-4.50", "EUR"),
      existing("unknown-amount", "2024-03-10", null),
    ],
  };

  it("finds same-amount transactions within the window, closest date first", () => {
    const [found] = matcher(5).resolve([row(1, "2024-03-10", "-4.50")], context) as ReturnType<
      ReturnType<typeof matcher>["resolve"]
    > &
      unknown[];

    expect(found!.candidates.map((c) => [c.transaction_id, c.days, c.score])).toEqual([
      ["same-day", 0, 1],
      ["two-later", 2, 0.6667],
    ]);
    expect(found!.final).toBe(false); // identifying and ranking only
  });

  it("breaks ties arbitrarily but stably", () => {
    const tied: Context = {
      account: "a",
      existing: [existing("b", "2024-03-11", "1"), existing("a", "2024-03-09", "1")],
    };
    const [found] = matcher(5).resolve([row(1, "2024-03-10", "1")], tied) as {
      candidates: { transaction_id: string }[];
    }[];

    expect(found!.candidates.map((c) => c.transaction_id)).toEqual(["a", "b"]);
  });

  it("returns an empty ranking when nothing matches", () => {
    const [found] = matcher(5).resolve([row(1, "2024-03-10", "-99")], context) as {
      candidates: unknown[];
    }[];

    expect(found!.candidates).toEqual([]);
  });
});

it("compares amounts as numbers, not strings", () => {
  expect(sameNumber("-4.5", "-4.50")).toBe(true);
  expect(sameNumber("004.50", "4.5")).toBe(true);
  expect(sameNumber("0.00", "-0")).toBe(true);
  expect(sameNumber("4.5", "-4.5")).toBe(false);
});

it("later resolvers see only what earlier ones didn't settle", async () => {
  const seen: number[][] = [];
  const settler: Resolver = {
    name: "settler",
    resolve: (batch) =>
      batch.map((r) => ({
        line: r.line,
        resolver: "settler",
        candidates: [],
        final: r.line === 1,
      })),
  };
  const watcher: Resolver = {
    name: "watcher",
    resolve: (batch) => {
      seen.push(batch.map((r) => r.line));
      return [];
    },
  };

  const results = await runChain(
    [settler, watcher],
    [row(1, "2024-01-01", "1"), row(2, "2024-01-01", "2")],
    { account: "a", existing: [] }
  );

  expect(seen).toEqual([[2]]);
  expect(results.get(1)!.map((r) => r.resolver)).toEqual(["settler"]);
});

describe("assignment", () => {
  const c = (transaction_id: string, score: number) =>
    ({ transaction_id, score }) as unknown as Candidate;

  it("gives each row the best candidate no better pair took; each transaction goes once", () => {
    const assigned = assign(
      new Map([
        [1, [c("a", 1), c("b", 0.5)]],
        [2, [c("a", 0.9), c("b", 0.8)]],
        [3, [c("a", 0.7)]],
      ])
    );

    expect([...assigned]).toEqual([
      [1, "a"],
      [2, "b"],
    ]); // row 3's only candidate was taken
  });

  it("breaks ties by row, then transaction", () => {
    const assigned = assign(
      new Map([
        [2, [c("b", 1), c("a", 1)]],
        [1, [c("b", 1)]],
      ])
    );

    expect(Object.fromEntries(assigned)).toEqual({ 1: "b", 2: "a" });
  });
});
