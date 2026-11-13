import { describe, expect, it } from "vitest";

import { filtering, kept, matchesSearch, touchesAny } from "./filters.js";

const megamart = {
  payee: "Megamart",
  narration: "Weekly shop",
  postings: [
    { account: "Liabilities:Card" },
    { account: "Expenses:Food", meta: { memo: "Oat milk" }, tags: ["home"] },
    { account: "Expenses:Home:Garden", meta: { memo: "Seed packets" }, tags: ["home", "gift"] },
  ],
};
const truck = {
  payee: null,
  narration: "TACO TRUCK",
  postings: [{ account: "Assets:Bank:Checking" }, { account: "Expenses:Food-Truck", meta: null }],
};

describe("search", () => {
  it("finds every word in the payee, the narration or a split's memo, ignoring case", () => {
    expect(matchesSearch(megamart, "megamart")).toBe(true);
    expect(matchesSearch(megamart, "WEEKLY")).toBe(true);
    expect(matchesSearch(megamart, "seed")).toBe(true);
    expect(matchesSearch(megamart, "  megamart   oat ")).toBe(true);
    expect(matchesSearch(megamart, "megamart taco")).toBe(false);
    expect(matchesSearch(truck, "taco")).toBe(true);
    expect(matchesSearch(truck, "")).toBe(true);
  });
});

describe("accounts", () => {
  it("keeps a transaction with a split in any of them, or under one", () => {
    expect(touchesAny(megamart, ["Expenses:Home"])).toBe(true);
    expect(touchesAny(megamart, ["Expenses:Home:Garden"])).toBe(true);
    expect(touchesAny(megamart, ["Expenses:Ho"])).toBe(false);
    expect(touchesAny(truck, ["Expenses:Food"])).toBe(false);
    expect(touchesAny(truck, ["Expenses:Food", "Expenses:Food-Truck"])).toBe(true);
    expect(touchesAny(truck, [])).toBe(true);
  });
});

describe("a filter", () => {
  it("keeps what every part of it keeps", () => {
    expect(kept(megamart, { q: "oat", accounts: ["Liabilities:Card"], tags: ["home"] })).toBe(true);
    expect(kept(megamart, { q: "oat", accounts: ["Assets:Bank"] })).toBe(false);
    expect(kept(megamart, { tags: ["home", "work"] })).toBe(false);
    expect(kept(megamart, { tags: ["home", "gift"] })).toBe(true); // both on the seeds
    expect(kept({ ...megamart, postings: megamart.postings.slice(0, 2) }, { tags: ["gift"] })).toBe(
      false
    );
    expect(kept(truck, { tags: ["home"] })).toBe(false);
    expect(kept(truck, {})).toBe(true);
  });

  it("says whether it keeps fewer than everything", () => {
    expect(filtering({})).toBe(false);
    expect(filtering({ q: "  ", tags: [], accounts: [] })).toBe(false);
    expect(filtering({ q: "oat" })).toBe(true);
    expect(filtering({ accounts: ["Expenses"] })).toBe(true);
    expect(filtering({ reconciled: false })).toBe(true);
  });
});
