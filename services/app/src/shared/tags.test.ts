import { describe, expect, it } from "vitest";

import {
  forWhole,
  hasTags,
  inheriting,
  splitHas,
  tagsOf,
  toTag,
  withoutTag,
  withTag,
  withTags,
} from "./tags.js";

describe("toTag", () => {
  it("makes what's typed a Beancount tag, lowercase and dashed", () => {
    expect(toTag("Trip to Italy!")).toBe("trip-to-italy");
    expect(toTag("#Reimbursable")).toBe("reimbursable");
    expect(toTag("  café  crème ")).toBe("cafe-creme");
    expect(toTag("tax/2026.q1_est")).toBe("tax/2026.q1_est");
    expect(toTag("a -- b")).toBe("a-b");
  });

  it("gives nothing when nothing's left", () => {
    expect(toTag("")).toBeNull();
    expect(toTag(" # ! ")).toBeNull();
  });
});

describe("hasTags", () => {
  it("needs every tag wanted", () => {
    expect(hasTags(["italy", "work"], ["italy"])).toBe(true);
    expect(hasTags(["italy", "work"], ["italy", "work"])).toBe(true);
    expect(hasTags(["italy"], ["italy", "work"])).toBe(false);
    expect(hasTags(undefined, [])).toBe(true);
  });
});

const bank = (tags: string[] = []) => ({ account: "Assets:Bank", tags });
const food = (tags: string[] = []) => ({ account: "Expenses:Food", tags });
const gift = (tags: string[] = []) => ({ account: "Expenses:Gifts", tags });

describe("a transaction's tags, from its splits", () => {
  it("are every tag a split has, sorted", () => {
    expect(tagsOf([bank(["trip"]), food(["work", "trip"]), { account: "Expenses:Gifts" }])).toEqual(
      ["trip", "work"]
    );
  });

  it("are filtered per split: one split has every tag wanted", () => {
    const receipt = [bank(), food(["italy"]), gift(["gift"])];
    expect(splitHas(receipt, ["italy"])).toBe(true);
    expect(splitHas(receipt, ["italy", "gift"])).toBe(false);
    expect(splitHas([bank(), food(["italy", "gift"])], ["italy", "gift"])).toBe(true);
    expect(splitHas(receipt, [])).toBe(true);
  });
});

describe("tagging a whole transaction", () => {
  it("tags what the money was for, not the bank's side", () => {
    expect(forWhole([bank(), food(), gift()])).toEqual([1, 2]);
    expect(withTag([bank(), food(["a"])], "trip")).toEqual([bank(), food(["a", "trip"])]);
  });

  it("tags both sides of a transfer", () => {
    const transfer = [bank(), { account: "Liabilities:Card", tags: [] }];
    expect(forWhole(transfer)).toEqual([0, 1]);
  });

  it("makes a transaction's tags what's wanted, from any it had", () => {
    expect(withTags([bank(["old"]), food(["old", "kept"])], ["kept", "new"])).toEqual([
      bank([]),
      food(["kept", "new"]),
    ]);
  });

  it("untags every split", () => {
    expect(withoutTag([bank(["trip"]), food(["trip", "work"])], "trip")).toEqual([
      bank([]),
      food(["work"]),
    ]);
  });
});

describe("itemizing", () => {
  it("gives the items the tags of the splits they replace", () => {
    expect(
      inheriting([food(), gift(["gift"])], [{ account: "Expenses:Uncategorized", tags: ["trip"] }])
    ).toEqual([food(["trip"]), gift(["gift", "trip"])]);
    expect(inheriting([food()], [{ account: "Expenses:Uncategorized" }])).toEqual([food()]);
  });
});
