import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { Sealer } from "@fava-beans/db";
import type { AiSettings, ReceiptReading } from "@fava-beans/ai-api";

import { createApi, type Role } from "../src/api.js";
import { AiDb } from "../src/db.js";
import { checked } from "../src/providers/types.js";
import { fake } from "../src/providers/fake.js";

const KEY = Buffer.alloc(32, 3).toString("base64");
let db: AiDb;
let roles: Record<string, Role>;
let api: ReturnType<typeof createApi>;

const call = (user: string, path: string, method = "GET", body?: unknown) =>
  api.request(`/api/ai/v1${path}`, {
    method,
    headers: { "x-user-id": user, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  db = new AiDb(join(mkdtempSync(join(tmpdir(), "ai-")), "ai.sqlite"));
  roles = { owner: "owner", writer: "write", reader: "read" };
  api = createApi({
    db,
    sealer: new Sealer(KEY),
    providers: [fake],
    roleOf: async (user) => roles[user] ?? null,
  });
});

const READ = {
  file: {
    data: Buffer.from("a photo").toString("base64"),
    media_type: "image/jpeg",
    filename: "jewel.jpg",
  },
  hints: { account: "Liabilities:Visa", itemize: true },
  accounts: [
    { name: "Liabilities:Visa", type: "liability", display_name: null },
    { name: "Expenses:Groceries", type: "expense", display_name: null },
  ],
  today: "2026-10-18",
  currency: "USD",
};

describe("a book's AI settings", () => {
  it("are a manager's to change, by version, and the key never comes back", async () => {
    const start = (await (await call("reader", "/books/b/settings")).json()) as AiSettings;
    expect([start.enabled, start.ready, start.updated_at]).toEqual([false, false, null]);
    expect(
      (await call("writer", "/books/b/settings", "PATCH", { updated_at: null, enabled: true }))
        .status
    ).toBe(403);
    expect((await call("stranger", "/books/b/settings")).status).toBe(404);

    const saved = (await (
      await call("owner", "/books/b/settings", "PATCH", {
        updated_at: null,
        enabled: true,
        provider: "fake",
        itemize: true,
      })
    ).json()) as AiSettings;
    expect([saved.enabled, saved.ready, saved.itemize]).toEqual([true, true, true]);
    expect(
      (await call("owner", "/books/b/settings", "PATCH", { updated_at: null, itemize: false }))
        .status
    ).toBe(409);

    const keyed = await call("owner", "/books/b/credential", "PUT", {
      api_key: "sk-ant-secret-1234",
    });
    const text = await keyed.text();
    expect(text).not.toContain("secret");
    expect((JSON.parse(text) as AiSettings).credential).toEqual({ set: true, hint: "1234" });
    expect(db.credential("b")).toMatch(/^v1:/); // sealed at rest
  });
});

describe("reading a receipt", () => {
  it("needs the book's AI set up, and a writer", async () => {
    expect((await call("writer", "/books/b/receipts/read", "POST", READ)).status).toBe(409);
    await call("owner", "/books/b/settings", "PATCH", {
      updated_at: null,
      enabled: true,
      provider: "fake",
    });
    expect((await call("reader", "/books/b/receipts/read", "POST", READ)).status).toBe(403);

    const read = await call("writer", "/books/b/receipts/read", "POST", READ);
    const reading = (await read.json()) as ReceiptReading;
    expect(read.status).toBe(200);
    expect(reading).toMatchObject({
      account: "Liabilities:Visa",
      total: "-12.34",
      category: "Expenses:Groceries",
    });
    expect(reading.splits.map((s) => s.amount)).toEqual(["6.17", "6.17"]); // itemized
  });

  it("checks a provider's answer, keeping what's good", () => {
    const reading = checked({
      account: "Assets:Bank",
      total: "twelve",
      currency: "USD",
      date: "yesterday",
      payee: "Jewel",
      narration: null,
      category: "Expenses:Groceries",
      splits: "lots",
      new_accounts: [],
      note: null,
    });
    expect([reading.account, reading.total, reading.date, reading.splits]).toEqual([
      "Assets:Bank",
      null,
      null,
      [],
    ]);
    expect(() => checked("not an object")).toThrow();
  });
});
