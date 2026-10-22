import { describe, expect, it } from "vitest";

import { stackHealth } from "./health.js";

const peers = { auth: "http://auth:3000", ledger: "http://ledger:8000", ai: "http://ai:3000" };

/** A fetch where the services named are down (an error) and the rest answer 200. */
const answering =
  (...down: string[]) =>
  async (url: string | URL | Request) => {
    const host = new URL(String(url)).hostname;
    if (down.includes(host)) throw new Error("connection refused");
    return new Response("{}", { status: 200 });
  };

describe("the stack's health", () => {
  it("is ok when everything answers, and asks each service's own /health", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => (asked.push(url), new Response("{}"))) as never;

    expect(await stackHealth(peers, fetchImpl)).toEqual({
      status: "ok",
      services: { auth: "up", ledger: "up", app: "up", ai: "up" },
    });
    expect(asked.sort()).toEqual([
      "http://ai:3000/health",
      "http://auth:3000/health",
      "http://ledger:8000/health",
    ]);
  });

  it("is degraded without the optional ai service, and down without a required one", async () => {
    expect((await stackHealth(peers, answering("ai") as never)).status).toBe("degraded");
    const down = await stackHealth(peers, answering("ledger") as never);
    expect(down).toEqual({
      status: "down",
      services: { auth: "up", ledger: "down", app: "up", ai: "up" },
    });
  });
});
