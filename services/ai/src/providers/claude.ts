/**
 * Claude does both operations (M16) through the official SDK's Messages API, each answer
 * constrained to its JSON Schema and checked again on arrival:
 *
 * - **Extract** (`claude-sonnet-5` unless `AI_CLAUDE_EXTRACT_MODEL` says otherwise): the receipt
 *   as an image (or PDF) block, under a system prompt that's mostly about getting the total
 *   right. If its lines don't add up to the total, it's told so once, in the same conversation
 *   (the receipt still in it), and reads again; if they still don't, the facts say by how much.
 * - **Categorize** (`claude-opus-5` unless `AI_CLAUDE_CATEGORIZE_MODEL` says otherwise): text
 *   only, the chart of accounts at the end of the system prompt, where it's cached between
 *   calls; with the server-side fallback on a refusal, on the models that have one.
 *
 * A refusal or any failure is ReadFailed: `app` carries on without it. Beyond the total, the
 * prompts are first drafts: evals and tuning are later work.
 */
import Anthropic from "@anthropic-ai/sdk";

import type {
  CategorizeOut,
  ExtractIn,
  PayeeReference,
  ReceiptFacts,
  ReceiptFile,
} from "@luminous-money/ai-api";

import {
  checkedFacts,
  checkedProposals,
  FACTS_JSON_SCHEMA,
  PROPOSALS_JSON_SCHEMA,
  ReadFailed,
  sumOf,
  type CategorizeInput,
  type Provider,
} from "./types.js";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
/** What it needs of the SDK's client: tests pass a stand-in. */
export type Client = { beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

export type ClaudeOptions = {
  extractModel: string;
  categorizeModel: string;
  client?: (apiKey: string) => Client;
};

const IMAGES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGES)[number];

/** The server-side fallback on a refusal (`fallbacks: "default"`), for the models that offer it. */
const FALLBACKS = /^claude-(opus-5|fable-5)/;

export const EXTRACT_SYSTEM = `You read photos and scans of receipts for a personal accounting app, and report what each receipt says. You don't categorize anything, and you know nothing about the person's accounts: report only what's on the receipt.

Answer with the JSON the schema describes. Leave anything you can't read as null, and never guess a number you can't see.

## The total

The total is the amount actually charged to the payment for this purchase: the money that left the card, account or cash (or, for a return, came back to it). It is the most important number on the receipt, so take care with it:

- It's usually labeled TOTAL, AMOUNT DUE, BALANCE DUE or AMOUNT, or printed beside the payment ("VISA ••9499 $23.50", "APPROVED 23.50"). When a payment line shows an amount, that is what was charged, and the total must equal it.
- It is not the subtotal (before tax), a "you saved" or savings line, an item count, a points or rewards balance, or a gift card's remaining balance.
- Cash: the total is what was due, not the cash tendered; the change given back isn't part of it.
- Restaurant and bar slips: if a tip and a new total are written in by hand, the total is the handwritten total (the printed amount plus the tip). If the tip line is blank or crossed out, the total is the printed amount.
- Split tender (paid partly by one card and partly by another, or by gift card and card): the total is the amount charged to one card; report that card as the payment, and say so in the note.
- Fuel and other pre-authorized payments: the final amount, not the authorization hold.
- A return or refund: the total is the amount given back, as a positive number, and refund is true.

Give amounts as printed, as decimals without currency symbols or thousands separators ("1234.50"). Give currency only when the receipt's isn't the book's (a three-letter code).

In total_evidence, quote the receipt's own words where you read the total: its label and amount, as printed.

## The lines

List the lines that make up the total, so that they add up to it exactly:

- every item bought, at its final price (after any per-item discount printed under it, and quantity × unit price where it shows both)
- tax, tip, fees and deposits (a bottle deposit, a bag fee) as lines of their own
- discounts and coupons as negative lines
- not subtotals, totals, payment lines, change, or "you saved" summaries

For each line, text is what's printed ("EGGS HPPY 18"), and description spells it out in plain words when the print is abbreviated ("Happy Egg Co. eggs, 18 count"); otherwise description is null. Amounts are as printed: positive for what was paid for, negative for discounts. On a refund they're positive too.

Before you answer, add the lines up: they must equal the total. If they don't, look again for a missed line, a misread digit, a discount you didn't subtract, or a quantity you didn't multiply, and fix what you find. If the receipt itself doesn't add up, report what it says and explain in the note.

## Everything else

- payee: the business, as a person would name it ("Jewel-Osco", not "JEWEL OSCO #3304").
- date: the date of the purchase, YYYY-MM-DD. A receipt without a year is from the last twelve months.
- payment: how it was paid. method is card, cash or other; for a card, its brand (visa, mastercard, amex, discover, or other) and its last four digits as printed ("••9499", "XXXXXXXXXXXX9499", "ending in 9499"). Null where the receipt doesn't show it.
- note: anything a person should know (a handwritten tip, a split tender, a faded or torn total), in one short sentence; otherwise null.`;

const EAGERNESS = {
  reluctant: "Open a new account only when nothing in the chart could reasonably hold a split.",
  average: "Open a new account when the chart has nothing that fits a split well.",
  aggressive: "Open new, specific accounts freely whenever they'd describe a split better.",
};

/** The categorizing system prompt's instructions: stable for a book. */
export function categorizeSystem(input: Pick<CategorizeInput, "creation" | "guidance">): string {
  const lines = [
    "You categorize transactions for a personal double-entry accounting app: for each transaction, choose the account each of its splits to place belongs in, from the book's chart of accounts.",
    "Answer with the JSON the schema describes.",
    "",
    "- Each transaction has known splits (where the money came from: a bank account or a card) and splits to place, each with its amount (positive is money spent) and, from a receipt, what the line was.",
    "- For each split to place, choose an account from the chart: an expense account for money spent, an income account for money received. Leave out a split you can't place with reasonable confidence.",
    "- fallback is the account the transaction as a whole belongs to (a grocery store's receipt: groceries), for any split you left out; null if you can't tell.",
    "- Put tax, tips and fees with what they were for (a grocery receipt's tax with the groceries), unless the chart has accounts for them.",
    "- The history is the person's own confirmed choices: follow how the same payee, and the same items, were categorized before, unless a split is clearly something else.",
    "- The reference, when there is one, sums up the person's past choices by payee (from the books they kept before and this one, recent ones weighing more): where each payee's transactions went, how often, and for how much. Use it like history: a bank's text for a payee often differs from what the old books called it (\"KROGER #123 CINCINNATI OH\" is \"Kroger\"), and a payee's amounts can tell its accounts apart.",
    "- confidence is 0 to 1: how likely the person is to accept your accounts unchanged.",
    '- reason is one short sentence the person sees ("Jewel-Osco is a grocery store; eggs and milk are groceries").',
  ];
  if (input.creation)
    lines.push(
      `- You may propose new accounts in new_accounts and use them: full names under Expenses or Income, each part capitalized, words joined by hyphens ("Expenses:Food:Coffee-Shops"), placed where they fit in the chart's hierarchy. ${EAGERNESS[input.creation.eagerness]}`
    );
  else lines.push("- Use only accounts in the chart; new_accounts stays empty.");
  if (input.guidance) lines.push("", `The person's guidance on accounts: ${input.guidance}`);
  return lines.join("\n");
}

function chartText(input: CategorizeInput): string {
  return [
    "The chart of accounts (leaves you may choose):",
    ...input.accounts.map(
      (a) =>
        `${a.name} (${a.type ?? "?"}${a.display_name ? `, "${a.display_name}"` : ""})${a.description ? `: ${a.description}` : ""}`
    ),
  ].join("\n");
}

/** The reference's entries, a line each: `Kroger (31 times, last 2026-06-14): Expenses:Groceries
 * 94% (31, typically 85.20, 12.00 to 210.00); …`. */
export function referenceText(reference: PayeeReference[]): string {
  const range = (a: PayeeReference["accounts"][number]) =>
    a.typical === null
      ? ""
      : `, typically ${a.typical}${a.low !== a.high ? `, ${a.low} to ${a.high}` : ""}`;
  return [
    "The reference for payees like these (where their transactions went before):",
    ...reference.map(
      (r) =>
        `${r.payee} (${r.seen} times, last ${r.last}): ${r.accounts
          .map((a) => `${a.account} ${Math.round(a.share * 100)}% (${a.seen}${range(a)})`)
          .join("; ")}`
    ),
  ].join("\n");
}

function receiptBlock({ data, media_type }: ReceiptFile): Anthropic.Beta.BetaContentBlockParam {
  if (media_type === "application/pdf")
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  if (IMAGES.includes(media_type as ImageType))
    return { type: "image", source: { type: "base64", media_type: media_type as ImageType, data } };
  throw new ReadFailed(`a receipt is an image or a PDF, not ${media_type}`);
}

/** What went wrong calling Claude, for the person who'll read it in review or on the AI page:
 * the API's own words where they help. */
export function failure(error: unknown, model: string): ReadFailed {
  if (error instanceof Anthropic.APIConnectionError)
    return new ReadFailed("Claude couldn't be reached (is this server online?)");
  if (error instanceof Anthropic.AuthenticationError)
    return new ReadFailed("Claude didn't accept the book's API key");
  if (error instanceof Anthropic.APIError) {
    const said = (error.error as { error?: { message?: string } } | undefined)?.error?.message;
    if (said && /credit balance/i.test(said))
      return new ReadFailed(
        "the Anthropic account has no credit left: add some in the Claude Console (Billing)"
      );
    if (error instanceof Anthropic.RateLimitError)
      return new ReadFailed("Claude is busy (rate limited): try again shortly");
    if (error instanceof Anthropic.PermissionDeniedError)
      return new ReadFailed(`the book's API key can't use ${model}${said ? `: ${said}` : ""}`);
    if (error instanceof Anthropic.NotFoundError)
      return new ReadFailed(`Claude has no model called ${model}`);
    if (error.status === 529 || error.type === "overloaded_error")
      return new ReadFailed("Claude is overloaded: try again shortly");
    return new ReadFailed(
      `Claude couldn't answer (${error.status ?? "no status"}${said ? `: ${said}` : ""})`
    );
  }
  return new ReadFailed("Claude couldn't be reached");
}

/** One request, its answer parsed (not yet checked); every way it can fail is ReadFailed. */
async function ask(
  client: Client,
  params: Params
): Promise<{ message: Anthropic.Beta.BetaMessage; answer: unknown }> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.stream(params).finalMessage();
  } catch (error) {
    throw failure(error, params.model);
  }
  if (message.stop_reason === "refusal") throw new ReadFailed("Claude declined");
  if (message.stop_reason === "max_tokens") throw new ReadFailed("the answer ran too long");
  // The last text: a model that declined mid-answer leaves its partial text before the
  // fallback's (`fallbacks: "default"`).
  const text = message.content.findLast((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ReadFailed("Claude gave no answer");
  try {
    return { message, answer: JSON.parse(text.text) };
  } catch {
    throw new ReadFailed("Claude's answer wasn't JSON");
  }
}

export function claude({ extractModel, categorizeModel, client }: ClaudeOptions): Provider {
  const connect = (credential: string | null): Client => {
    if (!credential) throw new ReadFailed("the book has no Claude API key");
    return client ? client(credential) : new Anthropic({ apiKey: credential });
  };
  return {
    name: "claude",

    async extract(input: ExtractIn, credential: string | null): Promise<ReceiptFacts> {
      const api = connect(credential);
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        {
          role: "user",
          content: [
            receiptBlock(input.file),
            {
              type: "text",
              text: `Today is ${input.today}, and the book's currency is ${input.currency}. Report what this receipt says.`,
            },
          ],
        },
      ];
      const request = (): Params => ({
        model: extractModel,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: EXTRACT_SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: { format: { type: "json_schema", schema: FACTS_JSON_SCHEMA } },
        messages,
      });
      const first = await ask(api, request());
      const facts = checkedFacts(first.answer);
      if (facts.difference === null) return facts;
      // A second look, in the same conversation: its answer as it gave it (thinking and all),
      // then what didn't add up.
      messages.push(
        {
          role: "assistant",
          content: first.message.content as Anthropic.Beta.BetaContentBlockParam[],
        },
        {
          role: "user",
          content: `Your lines add up to ${sumOf(facts)}, but the total is ${facts.total}. Look at the receipt again: find the line you missed or misread (or the total, if that's what's wrong), and answer again in full.`,
        }
      );
      try {
        return checkedFacts((await ask(api, request())).answer);
      } catch {
        return facts; // the first answer, saying how far off it is
      }
    },

    async categorize(input: CategorizeInput, credential: string | null): Promise<CategorizeOut> {
      const api = connect(credential);
      const fallbacks = FALLBACKS.test(categorizeModel)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {};
      const { answer } = await ask(api, {
        model: categorizeModel,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        ...fallbacks,
        system: [
          { type: "text", text: categorizeSystem(input) },
          { type: "text", text: chartText(input), cache_control: { type: "ephemeral" } },
        ],
        output_config: { format: { type: "json_schema", schema: PROPOSALS_JSON_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              `Amounts are in ${input.currency}.`,
              `The transactions to categorize:\n${JSON.stringify(input.transactions)}`,
              input.history.length
                ? `The book's history that bears on them (confirmed: the person's own choices):\n${JSON.stringify(input.history)}`
                : "The book has no history that bears on them.",
              ...(input.reference?.length ? [referenceText(input.reference)] : []),
            ].join("\n\n"),
          },
        ],
      } as Params);
      return checkedProposals(answer);
    },
  };
}
