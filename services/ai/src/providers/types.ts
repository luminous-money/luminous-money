/**
 * A provider does the two operations (M16): **extract** what a receipt says, and **categorize**
 * a transaction's unconfirmed splits. Each gets the same input and gives back the same shape,
 * checked here before it goes anywhere: a provider's answer is never trusted as is.
 */
import { z } from "zod";

import {
  CARD_BRANDS,
  type AiCall,
  type CategorizeIn,
  type CategorizeOut,
  type Eagerness,
  type ExtractIn,
  type LoanTableFacts,
  type LoanTableIn,
  type ProviderName,
  type ReceiptFacts,
} from "@luminous-money/ai-api";

export type CategorizeInput = CategorizeIn & {
  /** The book's own words about its accounts, if any. */
  guidance: string | null;
  /** Whether it may propose accounts to open, and how eagerly. */
  creation: { eagerness: Eagerness } | null;
};

/** Told what each call to a model cost, as it's answered. */
export type Meter = (call: AiCall) => void;

export interface Provider {
  name: ProviderName;
  extract(input: ExtractIn, credential: string | null, meter?: Meter): Promise<ReceiptFacts>;
  categorize(
    input: CategorizeInput,
    credential: string | null,
    meter?: Meter
  ): Promise<CategorizeOut>;
  /** Read a loan's amortization schedule into rows. */
  loanTable(input: LoanTableIn, credential: string | null, meter?: Meter): Promise<LoanTableFacts>;
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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What a schedule's facts must look like. Rows that don't read are dropped (the app checks
 * what's left adds up); with none left, it wasn't read. */
const LoanTableSchema = z.object({
  lender: nullable(z.string()),
  amount: nullable(decimal),
  rate: nullable(decimal),
  payments: nullable(z.number().int().positive()),
  first: nullable(z.string().regex(DATE)),
  rows: z
    .array(z.unknown())
    .catch([])
    .transform((rows) =>
      rows.flatMap((r) => {
        const row = z
          .object({
            number: nullable(z.number().int()),
            date: nullable(z.string().regex(DATE)),
            principal: decimal,
            interest: decimal,
            escrow: nullable(decimal),
            balance: decimal,
          })
          .safeParse(r);
        return row.success ? [row.data] : [];
      })
    ),
  note: nullable(z.string()),
});

export function checkedLoanTable(answer: unknown): LoanTableFacts {
  const parsed = LoanTableSchema.safeParse(answer);
  if (!parsed.success || !parsed.data.rows.length)
    throw new ReadFailed("the answer wasn't an amortization schedule's payments");
  return parsed.data;
}

const count = (description: string) => ({
  anyOf: [{ type: "integer" }, { type: "null" }],
  description,
});

/** A schedule's JSON Schema, for providers that constrain their output to one. */
export const LOAN_TABLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lender", "amount", "rate", "payments", "first", "rows", "note"],
  properties: {
    lender: text("Who the loan is with, as a person would name them."),
    amount: text("What was borrowed, as a decimal."),
    rate: text("The yearly interest rate, as a percent: 3.75 for 3.75%."),
    payments: count("How many payments the loan has, in all."),
    first: text("The first payment's due date, YYYY-MM-DD."),
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "date", "principal", "interest", "escrow", "balance"],
        properties: {
          number: count("The payment's number, as printed."),
          date: text("Its due date, YYYY-MM-DD."),
          principal: { type: "string", description: "Principal paid, as a decimal." },
          interest: { type: "string", description: "Interest paid, as a decimal." },
          escrow: text("Escrow (or other amounts paid with it), if the schedule shows them."),
          balance: { type: "string", description: "What's owed after it, as a decimal." },
        },
      },
    },
    note: text("Anything a person should know about reading it, in one short sentence."),
  },
} as const;
