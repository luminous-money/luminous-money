import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";

import { Sealer } from "@luminous-money/db";
import type { AiSettings, CategorizeIn, CategorizeOut, ReceiptFacts } from "@luminous-money/ai-api";

import { createApi, type Role } from "../src/api.js";
import { AiDb } from "../src/db.js";
import { claude, type Client } from "../src/providers/claude.js";
import { fake } from "../src/providers/fake.js";
import { checkedFacts, ReadFailed } from "../src/providers/types.js";

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

const PHOTO = {
  data: Buffer.from("a photo").toString("base64"),
  media_type: "image/jpeg",
  filename: "jewel.jpg",
};
const EXTRACT = { file: PHOTO, today: "2026-10-18", currency: "USD" };
const CATEGORIZE: CategorizeIn = {
  transactions: [
    {
      id: "t1",
      date: "2026-01-24",
      payee: "Jewel-Osco",
      narration: null,
      known: [{ account: "Liabilities:Visa", amount: "-19.98" }],
      splits: [
        { index: 1, amount: "9.99", memo: "EGGS HPPY 18" },
        { index: 2, amount: "9.99", memo: "MILK FRD ORG GAL" },
      ],
    },
  ],
  accounts: [
    { name: "Expenses:Uncategorized", type: "expense", display_name: null },
    { name: "Expenses:Groceries", type: "expense", display_name: null },
  ],
  history: [],
  currency: "USD",
};

const useFake = () =>
  call("owner", "/books/b/settings", "PATCH", {
    updated_at: null,
    enabled: true,
    provider: "fake",
  });

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

describe("the two operations", () => {
  it("need the book's AI set up, and a writer", async () => {
    expect((await call("writer", "/books/b/receipts/extract", "POST", EXTRACT)).status).toBe(409);
    await useFake();
    expect((await call("reader", "/books/b/receipts/extract", "POST", EXTRACT)).status).toBe(403);
    expect((await call("reader", "/books/b/categorize", "POST", CATEGORIZE)).status).toBe(403);
  });

  it("extract a receipt's facts, and categorize splits", async () => {
    await useFake();
    const facts = (await (
      await call("writer", "/books/b/receipts/extract", "POST", EXTRACT)
    ).json()) as ReceiptFacts;
    expect(facts).toMatchObject({ total: "12.34", payment: { last_four: "4242" } });
    expect(facts.lines.map((l) => l.amount)).toEqual(["6.17", "6.17"]);

    const out = (await (
      await call("writer", "/books/b/categorize", "POST", CATEGORIZE)
    ).json()) as CategorizeOut;
    expect(out.proposals[0]).toMatchObject({
      id: "t1",
      splits: [
        { index: 1, account: "Expenses:Groceries" },
        { index: 2, account: "Expenses:Groceries" },
      ],
      fallback: "Expenses:Groceries",
    });
  });

  it("check a provider's facts, keeping what's good and saying how far the lines are off", () => {
    const facts = checkedFacts({
      payee: "Jewel",
      date: "yesterday",
      currency: null,
      total: "23.50",
      total_evidence: "TOTAL 23.50",
      refund: false,
      payment: { method: "card", brand: "visa", last_four: "94" },
      lines: [{ text: "EGGS", description: null, amount: "9.99" }, { text: "?" }],
      note: null,
    });
    expect([facts.date, facts.payment, facts.lines.length, facts.difference]).toEqual([
      null,
      { method: "card", brand: "visa", last_four: null },
      1,
      "13.51",
    ]);
    expect(() => checkedFacts("not an object")).toThrow();
  });
});

/** A stand-in for the SDK's client: answers in turn (an Error is thrown, as the SDK throws; one
 * with a stop_reason is the whole message), and remembers what it was asked. */
function scripted(...answers: (object | "refusal" | Error)[]) {
  const asked: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          asked.push(structuredClone(params));
          const answer = answers.shift()!;
          return {
            finalMessage: async () => {
              if (answer instanceof Error) throw answer;
              if (typeof answer === "object" && "stop_reason" in answer) return answer;
              return answer === "refusal"
                ? { stop_reason: "refusal", content: [] }
                : {
                    stop_reason: "end_turn",
                    content: [
                      { type: "thinking", thinking: "", signature: "sig" },
                      { type: "text", text: JSON.stringify(answer) },
                    ],
                  };
            },
          };
        },
      },
    },
  } as unknown as Client;
  return { client, asked };
}

const FACTS = {
  payee: "Jewel-Osco",
  date: "2026-01-24",
  currency: null,
  total: "23.50",
  total_evidence: "TOTAL 23.50",
  refund: false,
  payment: { method: "card", brand: "visa", last_four: "9499" },
  lines: [
    { text: "EGGS HPPY 18", description: "Happy Egg Co. eggs, 18 count", amount: "9.99" },
    { text: "MILK FRD ORG GAL", description: null, amount: "9.99" },
  ],
  note: null,
};
const TAX = { text: "TAX", description: null, amount: "3.52" };
const models = { extractModel: "claude-sonnet-5", categorizeModel: "claude-opus-5" };

describe("Claude", () => {
  it("takes a second look, in the same conversation, when the lines don't add up", async () => {
    const { client, asked } = scripted(FACTS, { ...FACTS, lines: [...FACTS.lines, TAX] });
    const facts = await claude({ ...models, client: () => client }).extract(EXTRACT, "sk-key");

    expect(facts.difference).toBeNull();
    expect(facts.lines).toHaveLength(3);
    expect(asked.map((p) => p.model)).toEqual(["claude-sonnet-5", "claude-sonnet-5"]);
    const second = asked[1]!.messages as { role: string; content: unknown }[];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[2]!.content).toContain("Your lines add up to 19.98, but the total is 23.50");
  });

  it("says how far off it is if the second look doesn't help, and only looks twice", async () => {
    const { client, asked } = scripted(FACTS, FACTS);
    const facts = await claude({ ...models, client: () => client }).extract(EXTRACT, "sk-key");
    expect([facts.difference, asked.length]).toEqual(["3.52", 2]);
  });

  it("categorizes with the fallback on Opus, and a refusal is a failure to read", async () => {
    const out = { proposals: [], new_accounts: [] };
    const opus = scripted(out);
    await claude({ ...models, client: () => opus.client }).categorize(
      { ...CATEGORIZE, guidance: "Say what, not why.", creation: { eagerness: "average" } },
      "sk-key"
    );
    expect(opus.asked[0]).toMatchObject({ model: "claude-opus-5", fallbacks: "default" });
    expect(JSON.stringify(opus.asked[0]!.system)).toContain("Say what, not why.");

    const sonnet = scripted("refusal");
    await expect(
      claude({
        ...models,
        categorizeModel: "claude-sonnet-5",
        client: () => sonnet.client,
      }).categorize({ ...CATEGORIZE, guidance: null, creation: null }, "sk-key")
    ).rejects.toBeInstanceOf(ReadFailed);
    expect(sonnet.asked[0]).not.toHaveProperty("fallbacks");
  });

  it("reads the fallback's answer when Opus declined partway through its own", async () => {
    const out = { proposals: [], new_accounts: [] };
    const rescued = scripted({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: '{"propos' },
        { type: "fallback", from: { model: "claude-opus-5" }, to: { model: "claude-opus-4-8" } },
        { type: "text", text: JSON.stringify(out) },
      ],
    });
    await expect(
      claude({ ...models, client: () => rescued.client }).categorize(
        { ...CATEGORIZE, guidance: null, creation: null },
        "sk-key"
      )
    ).resolves.toMatchObject({ proposals: [] });
  });

  it("says what went wrong in Claude's own words: no credit, no model, unreachable", async () => {
    const said = (status: number, type: string, message: string) =>
      Anthropic.APIError.generate(
        status,
        { type: "error", error: { type, message } },
        message,
        new Headers()
      );
    const read = async (error: Error) => {
      const { client } = scripted(error);
      return claude({ ...models, client: () => client })
        .extract(EXTRACT, "sk-key")
        .then(
          () => "read",
          (e: Error) => e.message
        );
    };

    expect(
      await read(
        said(
          400,
          "invalid_request_error",
          "Your credit balance is too low to access the Anthropic API."
        )
      )
    ).toBe("the Anthropic account has no credit left: add some in the Claude Console (Billing)");
    expect(await read(said(404, "not_found_error", "model: claude-sonnet-5"))).toBe(
      "Claude has no model called claude-sonnet-5"
    );
    expect(await read(said(400, "invalid_request_error", "messages: something odd"))).toBe(
      "Claude couldn't answer (400: messages: something odd)"
    );
    expect(await read(new Anthropic.APIConnectionError({ message: "fetch failed" }))).toBe(
      "Claude couldn't be reached (is this server online?)"
    );
  });
});
