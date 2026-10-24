import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createApi } from "./api.js";
import { AppDb } from "./db.js";
import { isHeif, MAX_SIDE, normalized } from "./images.js";
import { FakeLedger } from "./testing.js";

// A synthetic HEIC (HEVC-coded, as an iPhone's are), made with libheif's heif-enc.
const HEIC = new Uint8Array(readFileSync(new URL("./fixtures/receipt.heic", import.meta.url)));
const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8;

describe("files as they're kept", () => {
  it("make an iPhone's HEIC a JPEG, whatever type the browser said", async () => {
    expect(isHeif(HEIC)).toBe(true);
    for (const type of ["image/heic", "", "application/octet-stream"]) {
      const kept = await normalized({ name: "IMG_0001.HEIC", type, bytes: HEIC });
      expect([kept.name, kept.type, isJpeg(kept.bytes)]).toEqual([
        "IMG_0001.jpg",
        "image/jpeg",
        true,
      ]);
      expect(await sharp(kept.bytes).metadata()).toMatchObject({ width: 600, height: 400 });
    }
  });

  it("shrink an image too big to keep, and keep the rest as they are", async () => {
    const noise = await sharp({
      create: {
        width: 2600,
        height: 1800,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    expect(noise.length).toBeGreaterThan(5 * 1024 * 1024);
    const kept = await normalized({ name: "scan.png", type: "image/png", bytes: noise });
    expect(kept.type).toBe("image/jpeg");
    expect((await sharp(kept.bytes).metadata()).width).toBe(MAX_SIDE);

    const small = { name: "a.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 1]) };
    expect(await normalized(small)).toBe(small);
    const pdf = { name: "r.pdf", type: "application/pdf", bytes: new Uint8Array([0x25, 0x50]) };
    expect(await normalized(pdf)).toBe(pdf);
    // An image it can't decode is kept as it is, to attach (a receipt refuses it).
    const broken = { name: "x.heic", type: "image/heic", bytes: new Uint8Array([1, 2, 3]) };
    expect(await normalized(broken)).toBe(broken);
  });
});

describe("attaching a file through the app", () => {
  it("keeps an iPhone's photo as a JPEG", async () => {
    const ledger = new FakeLedger();
    ledger.addBook("b");
    const t = ledger.addTransaction({
      date: "2026-01-22",
      flag: "*",
      narration: "Lunch",
      postings: [{ account: "Assets:Cash", units: { number: "-9", currency: "USD" } }],
    } as never);
    const app = createApi({
      db: new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite")),
      ledgerFor: () => ledger,
    });
    const response = await app.request(
      `/api/app/v1/books/b/transactions/${t.id}/attachments?filename=IMG_0001.HEIC`,
      { method: "POST", headers: { "x-user-id": "u1", "content-type": "image/heic" }, body: HEIC }
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ filename: "IMG_0001.jpg" });
    expect(ledger.attachments[0]).toMatchObject({ name: "IMG_0001.jpg", type: "image/jpeg" });
  });
});
