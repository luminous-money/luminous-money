import { describe, expect, it } from "vitest";

import { needsFund, notifications } from "./notifications.js";
import { FakeLedger } from "./testing.js";

const sale = (id: string, added: string) => ({
  id,
  date: "2026-11-04",
  flag: "!",
  payee: "Fidelity",
  narration: "Sold 20 VTI",
  added,
  updated_at: added,
  takes: [
    {
      fund: "Unallocated",
      amount: { number: "20", currency: "VTI" },
      holding: { number: "-20", currency: "VTI" },
    },
  ],
});

describe("notifications (Funds B)", () => {
  it("words a sale that needs a fund, which goes only once it's fixed", () => {
    expect(needsFund(sale("t1", "2026-11-04T06:00:00.000000Z"))).toEqual({
      id: "needs-fund:t1",
      kind: "needs-fund",
      added: "2026-11-04T06:00:00.000000Z",
      dismissable: false,
      title: "A sale needs a fund",
      detail:
        "Fidelity takes 20 VTI from Unallocated, which is 20 VTI short. Say which fund's shares they are.",
      transaction_id: "t1",
      date: "2026-11-04",
    });
  });

  it("lists the queue oldest first, read from the ledger each time", async () => {
    const ledger = new FakeLedger();
    ledger.shortList = [
      sale("later", "2026-11-05T06:00:00Z"),
      sale("first", "2026-11-04T06:00:00Z"),
    ];
    expect((await notifications(ledger, "b")).map((n) => n.transaction_id)).toEqual([
      "first",
      "later",
    ]);
    ledger.shortList = [];
    expect(await notifications(ledger, "b")).toEqual([]);
  });
});
