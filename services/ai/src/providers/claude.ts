/**
 * Claude reads receipts (M16), through the official SDK and the Messages API: the receipt as an
 * image (or a PDF) block, the chart of accounts and the hints as text, the book's guidance and
 * eagerness in the system prompt; the answer constrained to the reading's JSON Schema and checked
 * again on arrival. A refusal falls back server-side (`fallbacks: "default"`); one that still
 * refuses, or any failure, is "couldn't read it", and `app` makes the transaction without it.
 *
 * The prompt here is a first draft: the structure, inputs and outputs are this milestone's;
 * tuning it is later.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { ReceiptReading } from "@fava-beans/ai-api";

import {
  checked,
  ReadFailed,
  READING_JSON_SCHEMA,
  type Provider,
  type ReadInput,
} from "./types.js";

const IMAGES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGES)[number];

const EAGERNESS = {
  reluctant: "Open a new account only when nothing in the chart could reasonably hold a split.",
  average: "Open a new account when the chart has nothing that fits a split well.",
  aggressive: "Open new, specific accounts freely whenever they'd describe a split better.",
};

/** The system prompt: stable for a book, so it caches. */
function system(input: ReadInput): string {
  const lines = [
    "You read photos and scans of receipts into double-entry transactions for a personal accounting app.",
    "Answer only with the JSON the schema describes. Leave anything you can't tell as null.",
    'The base account is where the money came from (a bank account or card): choose it from the chart\'s asset and liability accounts, using the hint and anything on the receipt ("Visa ending 9499").',
    "The total is signed as it moves the base account: negative for a purchase, positive for a refund.",
    "Splits are signed as they move their categories (positive for an expense) and sum to minus the total; use the chart's expense and income accounts.",
    "The category is the one account the whole receipt best belongs to, the fallback for anything you can't place.",
  ];
  if (input.creation) {
    lines.push(
      `You may propose new accounts (full names, under Expenses or Income) in new_accounts, and use them in splits. ${EAGERNESS[input.creation.eagerness]}`
    );
    if (input.creation.guidance)
      lines.push(`The person's guidance on accounts: ${input.creation.guidance}`);
  } else {
    lines.push("Use only accounts already in the chart; new_accounts stays empty.");
  }
  return lines.join("\n");
}

/** The request's text: the chart, the hints, and what to do. */
function context(input: ReadInput): string {
  const chart = input.accounts
    .map((a) => `${a.name} (${a.type ?? "?"}${a.display_name ? `, "${a.display_name}"` : ""})`)
    .join("\n");
  const hints = Object.entries(input.hints)
    .filter(
      ([key, value]) => key !== "itemize" && value !== null && value !== undefined && value !== ""
    )
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return [
    `Today is ${input.today}; amounts are in ${input.currency} unless the receipt says otherwise.`,
    input.itemize
      ? "Itemize it: one split per line item (or group of like items), each categorized."
      : "Don't itemize: one split, the whole total, to the category.",
    `The chart of accounts:\n${chart}`,
    hints ? `What the person said (hints, not answers):\n${hints}` : "The person gave no hints.",
  ].join("\n\n");
}

export function claude(model: string): Provider {
  return {
    name: "claude",
    async read(input: ReadInput, credential: string | null): Promise<ReceiptReading> {
      if (!credential) throw new ReadFailed("the book has no Claude API key");
      const client = new Anthropic({ apiKey: credential });
      const { data, media_type } = input.file;
      const receipt: Anthropic.Beta.BetaContentBlockParam =
        media_type === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
          : IMAGES.includes(media_type as ImageType)
            ? {
                type: "image",
                source: { type: "base64", media_type: media_type as ImageType, data },
              }
            : (() => {
                throw new ReadFailed(`a receipt is an image or a PDF, not ${media_type}`);
              })();
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          system: system(input),
          output_config: { format: { type: "json_schema", schema: READING_JSON_SCHEMA } },
          messages: [{ role: "user", content: [receipt, { type: "text", text: context(input) }] }],
        });
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError)
          throw new ReadFailed("Claude didn't accept the book's API key");
        if (error instanceof Anthropic.RateLimitError)
          throw new ReadFailed("Claude is busy (rate limited): try again shortly");
        if (error instanceof Anthropic.APIError)
          throw new ReadFailed(`Claude couldn't read it (${error.status ?? "no status"})`);
        throw new ReadFailed("Claude couldn't be reached");
      }
      if (response.stop_reason === "refusal") throw new ReadFailed("Claude declined to read it");
      if (response.stop_reason === "max_tokens") throw new ReadFailed("the reading ran too long");
      const text = response.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") throw new ReadFailed("Claude gave no reading");
      try {
        return checked(JSON.parse(text.text));
      } catch {
        throw new ReadFailed("Claude's answer wasn't a reading");
      }
    },
  };
}
