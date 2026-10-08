import { describe, expect, it } from "vitest";

import { add, formatMoney, isDecimal, isZero, negate } from "./decimal.js";

describe("decimal strings", () => {
  it("adds exactly, aligning scales", () => {
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(add("-14.93", "14.93")).toBe("0.00");
    expect(add("1", "0.005")).toBe("1.005");
    expect(add("-0.50", "0.25")).toBe("-0.25");
    expect(add("99999999999999999.99", "0.01")).toBe("100000000000000000.00");
  });

  it("negates and detects zero", () => {
    expect(negate("4.50")).toBe("-4.50");
    expect(negate("-4.50")).toBe("4.50");
    expect(isZero("-0.00")).toBe(true);
    expect(isZero("0.01")).toBe(false);
  });

  it("validates the ledger's decimal format", () => {
    expect(isDecimal("12.50")).toBe(true);
    expect(isDecimal("-3")).toBe(true);
    expect(isDecimal("1e3")).toBe(false);
    expect(isDecimal("4.5.0")).toBe(false);
    expect(isDecimal("")).toBe(false);
  });

  it("formats money for display", () => {
    expect(formatMoney("-1234567.5", "USD")).toBe("−$1,234,567.5");
    expect(formatMoney("10", "VTI")).toBe("10 VTI");
  });
});
