import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const TEXT = `option "operating_currency" "USD"
2026-01-01 open Assets:Fidelity:Cash USD
2026-01-01 open Assets:Bank:PNC-Checking USD
`;
const PROFILE = {
  delimiter: ",",
  skip: 0,
  header: true,
  columns: ["Date", "Description", "Amount"],
  date: { column: 0, format: "MM/DD/YYYY" },
  amount: { kind: "signed", column: 2, negate: false },
  description: 1,
  payee: null,
  id: null,
  balance: null,
};

type Staged = { id: string; narration: string; postings: { account: string }[] }[];

describe("transfers paired in review", () => {
  before(stackIsUp);

  it("makes the two sides of a transfer one, and rejecting it brings the two back", async () => {
    const me = await newUser();
    const created = await me.app("/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago", text: TEXT }),
    });
    const { id: book } = (await created.json()) as { id: string };
    const app = (path: string, init: RequestInit = {}) => me.app(`/books/${book}${path}`, init);
    const bring = async (account: string, line: string) => {
      await app(`/profiles/${encodeURIComponent(account)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([PROFILE]),
      });
      const form = new FormData();
      form.set("account", account);
      form.set("file", new Blob([`Date,Description,Amount\n${line}\n`]), "f.csv");
      return (await app("/imports", { method: "POST", body: form })).json() as Promise<{
        rows: { transaction_id: string }[];
      }>;
    };
    const staged = async () =>
      (await (
        await fetch(`${BASE_URL}/api/ledger/v1/books/${book}/transactions?flag=!`, {
          headers: { authorization: `Bearer ${me.token}` },
        })
      ).json()) as Staged;

    await bring("Assets:Fidelity:Cash", "10/10/2026,TRANSFER TO PNC,-14000.00");
    const second = await bring(
      "Assets:Bank:PNC-Checking",
      "10/12/2026,TRANSFER FROM FIDELITY,14000.00"
    );

    const [transfer] = await staged();
    assert.equal((await staged()).length, 1);
    assert.deepEqual(
      transfer!.postings.map((p) => p.account),
      ["Assets:Fidelity:Cash", "Assets:Bank:PNC-Checking"]
    );
    assert.equal(second.rows[0]!.transaction_id, transfer!.id); // the import's row holds it
    const pairs = (await (await app("/transfers")).json()) as { transaction_id: string }[];
    assert.deepEqual(
      pairs.map((p) => p.transaction_id),
      [transfer!.id]
    );

    const rejected = await app(`/transfers/${transfer!.id}/reject`, { method: "POST" });

    assert.equal(rejected.status, 200);
    assert.deepEqual((await staged()).map((t) => t.narration).sort(), [
      "TRANSFER FROM FIDELITY",
      "TRANSFER TO PNC",
    ]);
    assert.deepEqual(await (await app("/transfers")).json(), []);
  });
});
