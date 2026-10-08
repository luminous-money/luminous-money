import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, eventually, newBook, stackIsUp } from "./support.ts";

describe("routing through Traefik", () => {
  before(stackIsUp);

  describe("/api", () => {
    it("routes /api/ledger/v1 to the ledger service", async () => {
      const response = await fetch(`${BASE_URL}/api/ledger/v1/books`);

      assert.equal(response.status, 200);
      assert.ok(Array.isArray(await response.json()));
    });

    it("serves the ledger's API schema under its prefix", async () => {
      const schema = await fetch(`${BASE_URL}/api/ledger/v1/openapi.json`);
      const body = (await schema.json()) as { info: { title: string } };

      assert.equal(schema.status, 200);
      assert.equal(body.info.title, "fava-beans ledger");
    });

    it("routes /api/app/v1 to the app service", async () => {
      const response = await fetch(`${BASE_URL}/api/app/v1/health`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    });
  });

  describe("/ui", () => {
    it("redirects the bare origin to the app", async () => {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });

      assert.ok([301, 302, 307, 308].includes(response.status), `got ${response.status}`);
      assert.equal(new URL(response.headers.get("location") ?? "", BASE_URL).pathname, "/ui/");
    });

    it("serves the PWA shell with its manifest and service worker", async () => {
      const page = await fetch(`${BASE_URL}/ui/`);
      const manifest = await fetch(`${BASE_URL}/ui/manifest.webmanifest`);
      const worker = await fetch(`${BASE_URL}/ui/sw.js`);
      const body = (await manifest.json()) as { scope: string; start_url: string };

      assert.equal(page.status, 200);
      assert.match(await page.text(), /<div id="root">/);
      assert.equal(body.scope, "/ui/");
      assert.equal(body.start_url, "/ui/");
      assert.equal(worker.status, 200);
      assert.equal(worker.headers.get("cache-control"), "no-cache");
    });

    it("serves the app shell for client-side routes, but not for missing assets", async () => {
      const route = await fetch(`${BASE_URL}/ui/review/some-entry`);
      const asset = await fetch(`${BASE_URL}/ui/assets/missing.js`);

      assert.equal(route.status, 200);
      assert.match(await route.text(), /<div id="root">/);
      assert.equal(asset.status, 404);
    });
  });

  describe("/fava", () => {
    it("routes /fava to a read-only Fava once a book has been exported", async () => {
      await newBook("routing");

      // Fava starts once the first export exists, so the first run of a fresh stack waits here.
      const home = await eventually(async () => {
        const response = await fetch(`${BASE_URL}/fava/`, { redirect: "manual" });
        assert.equal(response.status, 302);
        return response.headers.get("location") ?? "";
      });
      const slug = new URL(home, BASE_URL).pathname.split("/")[2];
      assert.ok(slug, `expected a ledger slug in ${home}`);

      const edit = await fetch(`${BASE_URL}/fava/${slug}/api/source`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_path: "/exports/x.beancount", source: "", sha256sum: "" }),
      });
      assert.ok(edit.status >= 400, `Fava accepted an edit (${edit.status})`);
    });
  });

  it("answers unknown top-level paths with 404 rather than reaching any service", async () => {
    const response = await fetch(`${BASE_URL}/no-such-route`);

    assert.equal(response.status, 404);
  });
});
