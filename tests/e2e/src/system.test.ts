/** Production readiness through the real stack: the public health, and the system page, an
 * admin's alone (named in the config, and confirmed). */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, linkMailedTo, newUser, stackIsUp } from "./support.ts";

const AUTH = `${BASE_URL}/api/auth/v1`;
// Named in services/app/.env/test's LUMINOUS_MONEY_ADMINS.
const ADMIN = "system-admin@test.local";

const post = (path: string, body: unknown) =>
  fetch(`${AUTH}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("the system", () => {
  before(stackIsUp);

  it("says it's healthy to anyone, and nothing more", async () => {
    const health = await fetch(`${BASE_URL}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      services: { auth: "up", ledger: "up", app: "up", ai: "up" },
    });
  });

  it("shows its page to an admin once their email is confirmed, and to no one else", async () => {
    const signedUp = await post("/signup", {
      name: "Admin",
      email: ADMIN,
      password: "a long enough admin passphrase",
      delivery: "body",
    });
    assert.equal(signedUp.status, 201);
    const { access_token } = (await signedUp.json()) as { access_token: string };
    const as = (path: string, init: RequestInit = {}) =>
      fetch(`${BASE_URL}/api/app/v1${path}`, {
        ...init,
        headers: { authorization: `Bearer ${access_token}` },
      });

    // Named, but not confirmed yet: nobody can sign up as an admin's address first.
    assert.deepEqual(await (await as("/system/access")).json(), { admin: false });
    assert.equal((await as("/system")).status, 404);

    const token = await linkMailedTo(ADMIN, "verify");
    assert.equal((await post("/email/verify", { token })).status, 204);
    assert.deepEqual(await (await as("/system/access")).json(), { admin: true });
    const system = (await (await as("/system")).json()) as {
      version: string;
      services: { name: string; status: string; schema: number | null }[];
      data: { databases: { name: string }[] };
      updates: { policy: string };
    };
    assert.deepEqual(
      system.services.map((s) => [s.name, s.status]),
      [
        ["app", "up"],
        ["auth", "up"],
        ["ledger", "up"],
        ["ai", "up"],
      ]
    );
    assert.ok(system.services.every((s) => typeof s.schema === "number"));
    assert.ok(system.data.databases.some((d) => d.name === "ledger.sqlite"));
    assert.equal(system.updates.policy, "off"); // tests never ask GitHub

    const someone = await newUser();
    assert.deepEqual(await (await someone.app("/system/access")).json(), { admin: false });
    assert.equal((await someone.app("/system")).status, 404);
    assert.equal((await someone.app("/system/check", { method: "POST" })).status, 404);
  });
});
