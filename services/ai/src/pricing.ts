/**
 * What a call to Claude cost, estimated from the usage it reported, at Anthropic's list prices
 * (USD per million tokens, the Claude API's global endpoint: platform.claude.com's pricing page,
 * 2026-10-26). An estimate, not the bill: the Console's billing is the truth.
 *
 * - **Cache writes** are priced as 5-minute ones (the only kind this service makes), unless the
 *   usage says how many were 1-hour.
 * - **A server-side fallback** (a refusal handed to another model) reports each attempt in
 *   `usage.iterations`, each billed at its own model's prices. An attempt that declined before
 *   any output is counted as unbilled (true outside a few policy categories that don't arise in
 *   bookkeeping).
 * - **Thinking** is output, already in `output_tokens`.
 */
import type { AiCall } from "@luminous-money/ai-api";

type Prices = { input: number; write5m: number; write1h: number; read: number; output: number };

/** By model ID's start, the most specific first. */
const PRICES: [string, Prices][] = [
  ["claude-fable-5-1", { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 }],
  ["claude-fable-5", { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 }],
  ["claude-opus-5-5", { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 }],
  ["claude-opus-5", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 }],
  ["claude-opus-4-8", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 }],
  ["claude-opus-4-7", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 }],
  ["claude-opus-4-6", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 }],
  ["claude-opus-4-5", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 }],
  ["claude-sonnet-5-5", { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 }],
  ["claude-sonnet-5", { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 }],
  ["claude-sonnet-4-6", { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 }],
  ["claude-sonnet-4-5", { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 }],
  ["claude-haiku-4-5", { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 }],
];

const pricesOf = (model: string) => PRICES.find(([id]) => model.startsWith(id))?.[1];

/** The usage a message reports, as far as pricing goes (the SDK's shape, loosely). */
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
  iterations?: (Usage & { type?: string; model?: string })[] | null;
};

/** One attempt's cost at `model`'s prices (null if they aren't known). */
function priced(model: string, u: Usage): AiCall {
  const read = u.cache_read_input_tokens ?? 0;
  const written = u.cache_creation_input_tokens ?? 0;
  const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const p = pricesOf(model);
  const usd = p
    ? (u.input_tokens * p.input +
        (written - hour) * p.write5m +
        hour * p.write1h +
        read * p.read +
        u.output_tokens * p.output) /
      1e6
    : null;
  return {
    model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: written,
    usd,
  };
}

/** A message's calls, one per attempt that's billed: the message itself, or (after a fallback)
 * each attempt in `usage.iterations` that produced output, and the one that answered. */
export function callsOf(model: string, usage: Usage): AiCall[] {
  const attempts = usage.iterations ?? [];
  if (!attempts.length) return [priced(model, usage)];
  return attempts
    .filter((a) => a.type === "fallback_message" || a.output_tokens > 0)
    .map((a) => priced(a.model ?? model, a));
}
