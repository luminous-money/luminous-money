/**
 * A provider reads a receipt into a proposed transaction. Each gets the same input (the receipt,
 * the hints, the chart of accounts, and what the book's settings allow) and gives back the same
 * shape, checked here before it goes anywhere: a provider's answer is never trusted as is.
 */
import { z } from "zod";

import type { Eagerness, ProviderName, ReceiptReadIn, ReceiptReading } from "@fava-beans/ai-api";

export type ReadInput = ReceiptReadIn & {
  /** Itemize: the hint's, else the book's setting. */
  itemize: boolean;
  /** Whether it may propose new accounts, how eagerly, and the book's guidance. */
  creation: { eagerness: Eagerness; guidance: string | null } | null;
};

export interface Provider {
  name: ProviderName;
  read(input: ReadInput, credential: string | null): Promise<ReceiptReading>;
}

/** The provider couldn't read it (declined, failed, or answered nonsense): `app` falls back. */
export class ReadFailed extends Error {}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const decimal = z.string().regex(DECIMAL);
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().catch(null);

/** What a reading must look like. Bad parts become null rather than sinking the rest. */
export const ReadingSchema = z.object({
  account: nullable(z.string()),
  total: nullable(decimal),
  currency: nullable(z.string()),
  date: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  payee: nullable(z.string()),
  narration: nullable(z.string()),
  category: nullable(z.string()),
  splits: z
    .array(z.object({ account: z.string(), amount: decimal, memo: nullable(z.string()) }))
    .catch([]),
  new_accounts: z.array(z.string()).catch([]),
  note: nullable(z.string()),
});

/** A provider's answer, checked. */
export function checked(answer: unknown): ReceiptReading {
  const parsed = ReadingSchema.safeParse(answer);
  if (!parsed.success) throw new ReadFailed("the answer wasn't a reading");
  return parsed.data as ReceiptReading;
}

/** The reading's JSON Schema, for providers that constrain their output to one. */
export const READING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "account",
    "total",
    "currency",
    "date",
    "payee",
    "narration",
    "category",
    "splits",
    "new_accounts",
    "note",
  ],
  properties: {
    account: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The base account: one of the chart's asset or liability accounts, or null.",
    },
    total: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Decimal, as it moves the base account: negative for a purchase, positive for a refund.",
    },
    currency: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }], description: "YYYY-MM-DD." },
    payee: { anyOf: [{ type: "string" }, { type: "null" }] },
    narration: { anyOf: [{ type: "string" }, { type: "null" }] },
    category: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The fallback category: an expense or income account.",
    },
    splits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["account", "amount", "memo"],
        properties: {
          account: { type: "string" },
          amount: {
            type: "string",
            description:
              "Decimal, as it moves the category: positive for an expense. They sum to minus the total.",
          },
          memo: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    new_accounts: { type: "array", items: { type: "string" } },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;
