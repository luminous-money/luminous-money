import { describe, expect, it } from "vitest";

import { hasTags, toTag } from "./tags.js";

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
