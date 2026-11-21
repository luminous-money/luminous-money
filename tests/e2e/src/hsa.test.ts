/** HSA tracking through the real stack: "Suggest categories" with the book's (fake) AI tags a
 * split that pays for something an HSA or FSA can pay for, `hsa-fsa-eligible`, recorded as the
 * AI's; with the book's "Suggest tags" off, it doesn't. (Amazon's mark is in orders.test.ts.) */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const CARD = "Liabilities:Card";
const usd = (number: string) => ({ number, currency: "USD" });

describe("HSA tracking", () => {
  before(stackIsUp);

  it("the AI tags what an HSA or FSA can pay for, unless Suggest tags is off", async () => {
    const user = await newUser();
    const { data: book } = await user.ledger.POST("/api/ledger/v1/books", {
      body: { name: "Mine" },
    });
    const id = book!.id;
    for (const name of [CARD, "Expenses:Health", "Expenses:Uncategorized"])
      await user.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
        params: { path: { book_id: id } },
        body: { name, kind: "leaf", opening_balance: null },
      });
    const ai = (path: string, method = "GET", body?: unknown) =>
      fetch(`${BASE_URL}/api/ai/v1/books/${id}${path}`, {
        method,
        headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const settings = (await (await ai("/settings")).json()) as {
      updated_at: string | null;
      suggest_tags: boolean;
    };
    assert.equal(settings.suggest_tags, true);
    const on = (await (
      await ai("/settings", "PATCH", {
        updated_at: settings.updated_at,
        enabled: true,
        provider: "fake",
      })
    ).json()) as { updated_at: string };

    const bought = async (memo: string) =>
      (
        await user.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
          params: { path: { book_id: id } },
          body: {
            date: "2026-03-01",
            flag: "!",
            payee: "Corner Pharmacy",
            narration: "",
            postings: [
              { account: CARD, units: usd("-12.00") },
              {
                account: "Expenses:Uncategorized",
                units: usd("12.00"),
                flag: "!",
                meta: { memo },
              },
            ],
          } as never,
        })
      ).data!;
    // A selection, so the AI is asked (Suggest categories for everything asks only the built-ins).
    const suggest = (tid: string) =>
      user.app(`/books/${id}/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactions: [tid] }),
      });
    const tagsOf = async (tid: string) =>
      (
        await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
          params: { path: { book_id: id, directive_id: tid } },
        })
      ).data!.postings.map((p) => p.tags ?? []);

    const bandages = await bought("BANDAGES 30CT");
    assert.equal((await suggest(bandages.id)).status, 200);
    assert.deepEqual(await tagsOf(bandages.id), [[], ["hsa-fsa-eligible"]]);
    const proposals = (await (await user.app(`/books/${id}/proposals`)).json()) as Record<
      string,
      { tags?: { index: number; tag: string; by: string }[] }
    >;
    assert.deepEqual(proposals[bandages.id]?.tags, [
      { index: 1, tag: "hsa-fsa-eligible", by: "ai" },
    ]);

    await ai("/settings", "PATCH", { updated_at: on.updated_at, suggest_tags: false });
    const thermometer = await bought("DIGITAL THERMOMETER");
    assert.equal((await suggest(thermometer.id)).status, 200);
    assert.deepEqual(await tagsOf(thermometer.id), [[], []]);

    // Which eligible spending still needs its receipt: the tag, and no file attached.
    const gauze = await bought("GAUZE PADS");
    assert.equal((await suggest(gauze.id)).status, 200); // Suggest tags is off: tag it by hand
    const { data: full } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      { params: { path: { book_id: id, directive_id: gauze.id } } }
    );
    await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path: { book_id: id, directive_id: gauze.id } },
      body: {
        updated_at: full!.updated_at,
        postings: full!.postings.map((p, i) =>
          i === 1 ? { ...p, tags: ["hsa-fsa-eligible"] } : p
        ),
      } as never,
    });
    const attached = await fetch(
      `${BASE_URL}/api/ledger/v1/books/${id}/transactions/${bandages.id}/attachments?filename=receipt.pdf`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${user.token}`, "content-type": "application/pdf" },
        body: new TextEncoder().encode("%PDF-1.4 made up"),
      }
    );
    assert.equal(attached.status, 201);
    const without = async (value: boolean) =>
      (
        await user.ledger.GET("/api/ledger/v1/books/{book_id}/journal", {
          params: { path: { book_id: id }, query: { tag: ["hsa-fsa-eligible"], attached: value } },
        })
      ).data!.rows.map((r) => r.id);
    assert.deepEqual(await without(false), [gauze.id]);
    assert.deepEqual(await without(true), [bandages.id]);
  });
});
