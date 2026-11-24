import { describe, expect, it } from "vitest";

import { addMonths, spanName, thisMonth } from "./months.js";

describe("months", () => {
  it("counts months across years", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", -17)).toBe("2025-01");
  });

  it("names a span: one month alone, a range, or from the start", () => {
    expect(spanName({ from: "2026-11", through: "2026-11" })).toBe("Nov 2026");
    expect(spanName({ from: "2026-01", through: "2027-12" })).toBe("Jan 2026 – Dec 2027");
    expect(spanName({ from: "start", through: thisMonth() })).toBe("All time");
    expect(spanName({ from: "start", through: "2020-03" })).toBe("Start – Mar 2020");
  });
});
