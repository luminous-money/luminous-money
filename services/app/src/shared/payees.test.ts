import { expect, it } from "vitest";

import { keySimilarity, payeeKey, SIMILAR } from "./payees.js";

it("strips bank noise, long numbers and a trailing state", () => {
  expect(payeeKey("POS DEBIT 0412 CORNER CAFE #42 CHICAGO IL")).toBe("corner cafe chicago");
  expect(payeeKey("DEBIT CARD PURCHASE CORNER CAFE #4211 CHICAGO IL")).toBe("corner cafe chicago");
  expect(payeeKey("PURCHASE AUTHORIZED ON 03/05 GROCER-MART 0001234 SPRINGFIELD")).toBe(
    "grocer mart springfield"
  );
  expect(payeeKey("ACH CREDIT ACME PAYROLL PPD ID: 123456789")).toBe("acme payroll");
  expect(payeeKey("NETFLIX.COM 866-579-7172 CA")).toBe("netflix com");
  expect(payeeKey("SQ *BLUE BOTTLE")).toBe("blue bottle");
  expect(payeeKey("12345")).toBe("");
});

it("keeps a two-letter word that's the whole key", () => {
  expect(payeeKey("IN")).toBe("in");
});

it("compares keys by shared words", () => {
  expect(keySimilarity("corner cafe chicago", "corner cafe chicago")).toBe(1);
  expect(keySimilarity("corner cafe chicago", "corner cafe evanston")).toBeGreaterThanOrEqual(0.5);
  expect(keySimilarity("blue bottle coffee", "blue bottle coffee oakland")).toBeGreaterThanOrEqual(
    SIMILAR
  );
  expect(keySimilarity("corner cafe chicago", "grocer mart springfield")).toBe(0);
  expect(keySimilarity("", "x")).toBe(0);
});
