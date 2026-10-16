import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe("configuration", () => {
  it("won't start without the SimpleFIN encryption key, or with a malformed one", async () => {
    delete process.env.SIMPLEFIN_ENCRYPTION_KEY;
    process.env.APP_ENV = "production";
    await expect(import("./config.js")).rejects.toThrow(/SIMPLEFIN_ENCRYPTION_KEY/);

    vi.resetModules();
    process.env.SIMPLEFIN_ENCRYPTION_KEY = "too short";
    await expect(import("./config.js")).rejects.toThrow(/32 random bytes/);
  });

  it("reads the environment's file, with the environment over it", async () => {
    process.env.APP_ENV = "test";
    process.env.SIMPLEFIN_HOSTS = "a.example, b.example";
    const { config } = await import("./config.js");
    expect(config.simplefin.allowInsecure).toBe(true); // from .env/test
    expect(config.simplefin.hosts).toEqual(["a.example", "b.example"]);
  });
});
