import { describe, expect, it } from "vitest";

import { certificateOf, stackHealth } from "./health.js";

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

  it("watches the gateway's certificate when it serves HTTPS for a domain", async () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const expiring = Date.parse("2026-11-01T12:00:00Z") / 1000;
    const fetchImpl = (async (url: string) =>
      new Response(
        url.endsWith("/metrics")
          ? `# TYPE traefik_tls_certs_not_after gauge\ntraefik_tls_certs_not_after{cn="books.example.com",sans="books.example.com",serial="1"} ${expiring}\n`
          : "{}"
      )) as never;

    const health = await stackHealth(
      { ...peers, gateway: "http://traefik:8082", domain: "books.example.com" },
      fetchImpl,
      now
    );

    expect(health.status).toBe("degraded");
    expect(health.certificate).toEqual({
      domain: "books.example.com",
      status: "expiring",
      expires: "2026-11-01T12:00:00.000Z",
      days_left: 9,
    });
  });
});

describe("a certificate in the gateway's metrics", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const line = (names: string, at: string) =>
    `traefik_tls_certs_not_after{cn="other.example.com",sans="${names}",serial="9"} ${Date.parse(at) / 1000}`;

  it("is the latest one naming the domain, among its alternative names too", () => {
    const metrics = [
      line("other.example.com,books.example.com", "2026-11-30T00:00:00Z"),
      line("books.example.com", "2027-01-15T00:00:00Z"), // renewed: the newer counts
      line("elsewhere.example.com", "2030-01-01T00:00:00Z"),
    ].join("\n");
    expect(certificateOf(metrics, "Books.Example.com", now)).toMatchObject({
      status: "ok",
      expires: "2027-01-15T00:00:00.000Z",
      days_left: 84,
    });
  });

  it("is expired, or missing, when there isn't a good one", () => {
    expect(
      certificateOf(line("books.example.com", "2026-10-01T00:00:00Z"), "books.example.com", now)
        .status
    ).toBe("expired");
    expect(certificateOf("", "books.example.com", now)).toEqual({
      domain: "books.example.com",
      status: "missing",
      expires: null,
      days_left: null,
    });
  });
});
