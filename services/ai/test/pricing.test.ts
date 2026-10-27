import { describe, expect, it } from "vitest";

import { addCost, formatUsd, NO_COST } from "@luminous-money/ai-api";

import { callsOf } from "../src/pricing.js";

describe("what a call cost", () => {
  it("is its tokens at the model's prices, cache reads and writes included", () => {
    const [call] = callsOf("claude-opus-5", {
      input_tokens: 10_000,
      output_tokens: 2_000,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 4_000,
    });
    // $5 in, $25 out, $0.50 read, $6.25 written (5 minutes), per million.
    expect(call!.usd).toBeCloseTo(0.05 + 0.05 + 0.02 + 0.025, 10);
    expect(callsOf("claude-sonnet-5", { input_tokens: 1e6, output_tokens: 1e6 })[0]!.usd).toBe(12);
  });

  it("prices hour-long cache writes as such", () => {
    const [call] = callsOf("claude-sonnet-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1e6,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1e6 },
    });
    expect(call!.usd).toBe(4);
  });

  it("counts a fallback's attempts at their own models' prices, not a decline before output", () => {
    const calls = callsOf("claude-opus-4-8", {
      input_tokens: 412,
      output_tokens: 264,
      iterations: [
        { type: "message", model: "claude-opus-5", input_tokens: 535, output_tokens: 0 },
        {
          type: "fallback_message",
          model: "claude-opus-4-8",
          input_tokens: 412,
          output_tokens: 264,
        },
      ],
    });
    expect(calls.map((c) => c.model)).toEqual(["claude-opus-4-8"]);

    const midway = callsOf("claude-opus-4-8", {
      input_tokens: 412,
      output_tokens: 264,
      iterations: [
        { type: "message", model: "claude-opus-5", input_tokens: 1e6, output_tokens: 0 + 1e6 },
        { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 0, output_tokens: 0 },
      ],
    });
    expect(midway.map((c) => [c.model, c.usd])).toEqual([
      ["claude-opus-5", 30],
      ["claude-opus-4-8", 0],
    ]);
  });

  it("is unknown for a model without prices, and sums as unknown", () => {
    const [call] = callsOf("claude-future-9", { input_tokens: 1, output_tokens: 1 });
    expect(call!.usd).toBeNull();
    expect(addCost(addCost(NO_COST, call!), { ...call!, usd: 1 }).usd).toBeNull();
    expect(formatUsd(null)).toBe("an unknown amount");
    expect([formatUsd(0.0042), formatUsd(0.031), formatUsd(12.4)]).toEqual([
      "$0.0042",
      "$0.03",
      "$12.40",
    ]);
  });
});
