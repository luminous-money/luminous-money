import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createApi } from "./api.js";
import { AppDb } from "./db.js";
import { createSystem, dataUsage, newerThan } from "./system.js";
import { FakeLedger } from "./testing.js";

const peers = { auth: "http://auth:3000", ledger: "http://ledger:8000", ai: "http://ai:3000" };

/** A fetch answering each service's /health, and GitHub's latest release as `release` (null:
 * there's none), counting the calls to GitHub. */
function fakeFetch(release: { tag_name: string } | null) {
  const github: string[] = [];
  const fetchImpl = (async (url: string) => {
    if (url.startsWith("https://api.github.com/")) {
      github.push(url);
      return release
        ? Response.json({
            ...release,
            html_url: `https://github.com/x/y/releases/${release.tag_name}`,
          })
        : new Response("{}", { status: 404 });
    }
    return Response.json({ status: "ok", version: "0.2.0", schema: 7 });
  }) as never;
  return { fetchImpl, github };
}

function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), "system-"));
  writeFileSync(join(dir, "ledger.sqlite"), "x".repeat(100));
  writeFileSync(join(dir, "ledger.sqlite-wal"), "x".repeat(20));
  writeFileSync(join(dir, "app.sqlite"), "x".repeat(50));
  mkdirSync(join(dir, "attachments", "book"), { recursive: true });
  writeFileSync(join(dir, "attachments", "book", "a1"), "x".repeat(7));
  return dir;
}

describe("the system's facts", () => {
  it("knows which version is newer, and that a development build isn't on the line", () => {
    expect(newerThan("0.2.0", "0.1.9")).toBe(true);
    expect(newerThan("v1.0.0", "0.9.0")).toBe(true);
    expect(newerThan("0.2.0", "0.2.0")).toBe(false);
    expect(newerThan("0.2.0", "0.2.0-rc.1")).toBe(true);
    expect(newerThan("0.2.0-rc.1", "0.2.0")).toBe(false);
    expect(newerThan("0.2.0", "dev")).toBe(false);
  });

  it("measure the databases (with their WAL files) and the attachments", () => {
    expect(dataUsage(dataDir())).toEqual({
      databases: [
        { name: "app.sqlite", bytes: 50 },
        { name: "ledger.sqlite", bytes: 120 },
      ],
      attachments: 7,
      total: 177,
    });
  });

  it("say what's running, the last backup, and whether a newer release is out", async () => {
    const dir = dataDir();
    writeFileSync(
      join(dir, "last-backup.json"),
      '{"made_at":"2026-10-23T03:00:00Z","version":"0.2.0"}'
    );
    const { fetchImpl, github } = fakeFetch({ tag_name: "v0.3.0" });
    const system = createSystem({
      version: "0.2.0",
      dataDir: dir,
      peers,
      policy: "notify",
      upgradeAt: "03:30",
      repo: "luminous-money/luminous-money",
      schema: () => 18,
      fetchImpl,
    });

    await system.check();
    const info = await system.info();

    expect(github).toEqual([
      "https://api.github.com/repos/luminous-money/luminous-money/releases/latest",
    ]);
    expect(info.services).toContainEqual({
      name: "app",
      status: "up",
      version: "0.2.0",
      schema: 18,
    });
    expect(info.services).toContainEqual({
      name: "ledger",
      status: "up",
      version: "0.2.0",
      schema: 7,
    });
    expect(info.backup).toEqual({ made_at: "2026-10-23T03:00:00Z", version: "0.2.0" });
    expect(info.updates).toMatchObject({
      policy: "notify",
      upgrade_at: null, // only with auto
      newer: true,
      latest: { version: "0.3.0", url: "https://github.com/x/y/releases/v0.3.0" },
      error: null,
    });
  });

  it("never ask GitHub when updates are off", async () => {
    const { fetchImpl, github } = fakeFetch({ tag_name: "v9.0.0" });
    const system = createSystem({
      version: "0.2.0",
      dataDir: dataDir(),
      peers,
      policy: "off",
      upgradeAt: null,
      repo: "luminous-money/luminous-money",
      fetchImpl,
    });
    await system.check();
    expect(github).toEqual([]);
    expect((await system.info()).updates.latest).toBeNull();
  });
});

describe("the system page", () => {
  const api = () => {
    const db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
    const facts = createSystem({
      version: "0.2.0",
      dataDir: dataDir(),
      peers,
      policy: "off",
      upgradeAt: null,
      repo: "luminous-money/luminous-money",
      fetchImpl: fakeFetch(null).fetchImpl,
    });
    return createApi({
      db,
      ledgerFor: () => new FakeLedger(),
      system: { facts, admins: new Set(["admin@example.com"]) },
    });
  };
  const as = (email: string, verified: boolean) => ({
    "x-user-id": "u1",
    "x-user-email": encodeURIComponent(email),
    "x-user-email-verified": String(verified),
  });

  it("is an admin's alone: named, and confirmed", async () => {
    const app = api();
    const access = async (headers: Record<string, string>) =>
      (await (await app.request("/api/app/v1/system/access", { headers })).json()) as {
        admin: boolean;
      };

    expect(await access(as("Admin@Example.com", true))).toEqual({ admin: true });
    expect(await access(as("admin@example.com", false))).toEqual({ admin: false });
    expect(await access(as("someone@example.com", true))).toEqual({ admin: false });

    expect(
      (await app.request("/api/app/v1/system", { headers: as("admin@example.com", true) })).status
    ).toBe(200);
    expect(
      (await app.request("/api/app/v1/system", { headers: as("admin@example.com", false) })).status
    ).toBe(404);
    expect(
      (
        await app.request("/api/app/v1/system/check", {
          method: "POST",
          headers: as("x@example.com", true),
        })
      ).status
    ).toBe(404);
  });
});
