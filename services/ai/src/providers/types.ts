/**
 * A provider does the two operations (M16): **extract** what a receipt says, and **categorize**
 * a transaction's unconfirmed splits. Each gets the same input and gives back the same shape,
 * checked here before it goes anywhere: a provider's answer is never trusted as is.
 */
import { z } from "zod";

import {
  CARD_BRANDS,
  type CategorizeIn,
  type CategorizeOut,
  type Eagerness,
  type ExtractIn,
  type ProviderName,
  type ReceiptFacts,
} from "@luminous-money/ai-api";

export type CategorizeInput = CategorizeIn & {
  /** The book's own words about its accounts, if any. */
  guidance: string | null;
  /** Whether it may propose accounts to open, and how eagerly. */
  creation: { eagerness: Eagerness } | null;
};

export interface Provider {
  name: ProviderName;
  extract(input: ExtractIn, credential: string | null): Promise<ReceiptFacts>;
  categorize(input: CategorizeInput, credential: string | null): Promise<CategorizeOut>;
}

/** The provider couldn't answer (declined, failed, or answered nonsense): `app` carries on
 * without it. */
export class ReadFailed extends Error {}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const decimal = z.string().regex(DECIMAL);
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().catch(null);

/** What a receipt's facts must look like. Bad parts become null (or are dropped) rather than
 * sinking the rest. */
const FactsSchema = z.object({
  payee: nullable(z.string()),
  date: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  currency: nullable(z.string().regex(/^[A-Z]{3}$/)),
  total: nullable(decimal),
  total_evidence: nullable(z.string()),
  refund: z.boolean().catch(false),
  payment: z
    .object({
      method: nullable(z.enum(["card", "cash", "other"])),
      brand: nullable(z.enum(CARD_BRANDS)),
      last_four: nullable(z.string().regex(/^\d{4}$/)),
    })
    .catch({ method: null, brand: null, last_four: null }),
  lines: z
    .array(z.unknown())
    .catch([])
    .transform((lines) =>
      lines.flatMap((l) => {
        const line = z
          .object({ text: z.string(), description: nullable(z.string()), amount: decimal })
          .safeParse(l);
        return line.success ? [line.data] : [];
      })
    ),
  note: nullable(z.string()),
});

export function checkedFacts(answer: unknown): ReceiptFacts {
  const parsed = FactsSchema.safeParse(answer);
  if (!parsed.success) throw new ReadFailed("the answer wasn't a receipt's facts");
  return { ...parsed.data, difference: gap(parsed.data) };
}

const cents = (d: string) => {
  const [whole, frac = ""] = d.replace("-", "").split(".");
  const n = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return d.startsWith("-") ? -n : n;
};
const decimalOf = (c: number) =>
  `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

/** How far the lines are from the total (total − their sum), or null when they agree (or
 * there's nothing to compare). */
export function gap(facts: Pick<ReceiptFacts, "total" | "lines">): string | null {
  if (facts.total === null || !facts.lines.length) return null;
  const off = cents(facts.total) - facts.lines.reduce((n, l) => n + cents(l.amount), 0);
  return off === 0 ? null : decimalOf(off);
}

/** The lines' sum, for telling the model what it added up to. */
export const sumOf = (facts: Pick<ReceiptFacts, "lines">) =>
  decimalOf(facts.lines.reduce((n, l) => n + cents(l.amount), 0));

const ProposalsSchema = z.object({
  proposals: z
    .array(z.unknown())
    .catch([])
    .transform((all) =>
      all.flatMap((p) => {
        const proposal = z
          .object({
            id: z.string(),
            splits: z.array(z.object({ index: z.number().int(), account: z.string() })).catch([]),
            fallback: nullable(z.string()),
            confidence: z.number().min(0).max(1).catch(0.5),
            reason: z.string().catch(""),
          })
          .safeParse(p);
        return proposal.success ? [proposal.data] : [];
      })
    ),
  new_accounts: z.array(z.string()).catch([]),
});

export function checkedProposals(answer: unknown): CategorizeOut {
  const parsed = ProposalsSchema.safeParse(answer);
  if (!parsed.success) throw new ReadFailed("the answer wasn't a categorization");
  return parsed.data;
}

const text = (description?: string) => ({
  anyOf: [{ type: "string" }, { type: "null" }],
  ...(description ? { description } : {}),
});

/** The facts' JSON Schema, for providers that constrain their output to one. */
export const FACTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "payee",
    "date",
    "currency",
    "total",
    "total_evidence",
    "refund",
    "payment",
    "lines",
    "note",
  ],
  properties: {
    payee: text("The business, as a person would name it."),
    date: text("The purchase date, YYYY-MM-DD."),
    currency: text("A three-letter code, only if it isn't the book's."),
    total: text("What was charged to the payment (or refunded), as printed: a positive decimal."),
    total_evidence: text("The receipt's own words where the total was read, as printed."),
    refund: { type: "boolean" },
    payment: {
      type: "object",
      additionalProperties: false,
      required: ["method", "brand", "last_four"],
      properties: {
        method: { anyOf: [{ type: "string", enum: ["card", "cash", "other"] }, { type: "null" }] },
        brand: { anyOf: [{ type: "string", enum: [...CARD_BRANDS] }, { type: "null" }] },
        last_four: text("The card's last four digits."),
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "description", "amount"],
        properties: {
          text: { type: "string", description: "As printed." },
          description: text("In plain words, when the print is abbreviated."),
          amount: {
            type: "string",
            description: "As printed: positive for what was paid for, negative for a discount.",
          },
        },
      },
    },
    note: text(),
  },
} as const;

/** The proposals' JSON Schema. */
export const PROPOSALS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals", "new_accounts"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "splits", "fallback", "confidence", "reason"],
        properties: {
          id: { type: "string" },
          splits: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["index", "account"],
              properties: { index: { type: "integer" }, account: { type: "string" } },
            },
          },
          fallback: text("The account the transaction as a whole belongs to."),
          confidence: { type: "number", description: "0 to 1." },
          reason: { type: "string" },
        },
      },
    },
    new_accounts: { type: "array", items: { type: "string" } },
  },
} as const;
