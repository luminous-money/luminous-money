import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createApi } from "./api.js";
import { AppDb } from "./db.js";
import { FakeLedger } from "./testing.js";

it("a stale edit's 409 says it's stale, so the PWA can tell it from the other conflicts", async () => {
  const db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  const ledger = new FakeLedger();
  ledger.addBook("b");
  const app = createApi({ db, ledgerFor: () => ledger });
  const patch = (body: unknown) =>
    app.request("/api/app/v1/books/b/settings", {
      method: "PATCH",
      headers: { "x-user-id": "u1", "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Not stale: the book has no settings to change yet.
  const early = await patch({ week_start: 1, updated_at: "x" });
  expect(early.status).toBe(409);
  expect(await early.json()).toEqual({ detail: "set the book's time zone first" });

  db.setTimeZone("b", "America/Chicago", "u1");
  const stale = await patch({ week_start: 1, updated_at: "not what was read" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "stale" });
});
