/**
 * The app API, at /api/app/v1. Every route needs the caller (X-User-Id, set by Traefik after
 * checking the session), and acts as them toward the ledger, so book ownership is the ledger's
 * call: a book the caller doesn't own answers 404 here too.
 */
import { Hono } from "hono";

import type { CsvProfile } from "@fava-beans/csv-import";

import type { AppDb } from "./db.js";
import { ImportProblem, importFile } from "./imports.js";
import type { LedgerPort } from "./ledger.js";

type Env = { Variables: { user: string } };

export function createApi({
  db,
  ledgerFor,
}: {
  db: AppDb;
  ledgerFor: (userId: string) => LedgerPort;
}) {
  const api = new Hono<Env>().basePath("/api/app/v1");

  api.get("/health", (c) => c.json({ status: "ok" }));

  api.use("/books/*", async (c, next) => {
    const user = c.req.header("x-user-id");
    if (!user) return c.json({ detail: "not logged in" }, 401);
    c.set("user", user);
    return next();
  });

  /** 404 unless the caller owns the book. */
  const owned = async (user: string, book: string) =>
    (await ledgerFor(user).book(book)) !== undefined;

  const isProfile = (p: unknown): p is CsvProfile => {
    const profile = p as CsvProfile | undefined;
    return (
      Array.isArray(profile?.columns) &&
      typeof profile.date?.column === "number" &&
      !!profile.amount
    );
  };

  /** An account's CSV profiles (its bank's file formats), oldest first; empty if none yet. */
  api.get("/books/:book/profiles/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.profiles(book, account));
  });

  /** Replace all of an account's CSV profiles with the ones given. */
  api.put("/books/:book/profiles/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const profiles = (await c.req.json()) as unknown;
    if (!Array.isArray(profiles) || !profiles.every(isProfile)) {
      return c.json({ detail: "send a list of CSV profiles" }, 422);
    }
    db.replaceProfiles(book, account, profiles);
    return c.json(db.profiles(book, account));
  });

  /** Add a CSV profile to an account's. */
  api.post("/books/:book/profiles/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const profile = (await c.req.json()) as unknown;
    if (!isProfile(profile)) return c.json({ detail: "that isn't a CSV profile" }, 422);
    db.addProfile(book, account, profile);
    return c.json(db.profiles(book, account), 201);
  });

  /** Import a file: multipart form data with `account` and `file`. */
  api.post("/books/:book/imports", async (c) => {
    const { book } = c.req.param();
    const form = await c.req.parseBody();
    const account = form["account"];
    const file = form["file"];
    if (typeof account !== "string" || !(file instanceof File)) {
      return c.json({ detail: "send an account and a file" }, 422);
    }
    try {
      const result = await importFile({
        db,
        ledger: ledgerFor(c.get("user")),
        book,
        account,
        filename: file.name,
        text: await file.text(),
        userId: c.get("user"),
      });
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof ImportProblem) {
        return c.json(
          { detail: error.message, code: error.code },
          error.code === "no-such-book" ? 404 : 409
        );
      }
      throw error;
    }
  });

  api.get("/books/:book/imports", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.batches(book, c.req.query("account")));
  });

  /** Each account's last import time: what the home page shows as "last updated". */
  api.get("/books/:book/imports/latest", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.lastImports(book));
  });

  api.get("/books/:book/imports/:batch", async (c) => {
    const { book, batch } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const found = db.batch(book, batch);
    return found
      ? c.json({ batch: found, rows: db.rows(batch) })
      : c.json({ detail: "not found" }, 404);
  });

  return api;
}
