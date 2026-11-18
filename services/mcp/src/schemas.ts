/**
 * Tools' input schemas. The ledger's come from its OpenAPI document (packages/ledger-client), so
 * a tool takes what the API takes, described as the API describes it; `app`'s are written here
 * from its types (services/app/src/shared).
 */
import openapi from "@luminous-money/ledger-client/openapi.json" with { type: "json" };

export type JsonSchema = { [key: string]: unknown };

const components = (openapi as { components: { schemas: Record<string, JsonSchema> } }).components
  .schemas;

/** A schema with its `$ref`s resolved in place, without what a model has no use for (the titles
 * FastAPI adds, length limits), and `anyOf: [X, null]` said as X that may be null. */
function resolved(schema: unknown, seen: string[] = []): unknown {
  if (Array.isArray(schema)) return schema.map((s) => resolved(s, seen));
  if (!schema || typeof schema !== "object") return schema;
  const node = schema as JsonSchema;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").at(-1)!;
    if (seen.includes(name)) return { type: "object" };
    return resolved(components[name], [...seen, name]);
  }
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    // Titles repeat the property's name; the rest are checks the API makes anyway.
    if (["title", "additionalProperties", "minLength", "maxLength"].includes(key)) continue;
    if (key === "properties") {
      out.properties = Object.fromEntries(
        Object.entries(value as JsonSchema).map(([k, v]) => [k, resolved(v, seen)])
      );
      continue;
    }
    out[key] = resolved(value, seen);
  }
  const options = out.anyOf as JsonSchema[] | undefined;
  if (options?.length === 2 && options.some((o) => o.type === "null")) {
    const other = options.find((o) => o.type !== "null")!;
    delete out.anyOf;
    const merged: JsonSchema = { ...other, ...out };
    if (typeof other.type === "string") merged.type = [other.type, "null"];
    else merged.nullable = true;
    return merged;
  }
  return out;
}

/** A ledger schema by name (`TransactionIn`), resolved. */
export function ledgerSchema(name: string, description?: string): JsonSchema {
  if (!components[name]) throw new Error(`the ledger has no schema ${name}`);
  const schema = resolved(components[name]) as JsonSchema;
  return description ? { ...schema, description } : schema;
}

// Building blocks for the rest.

export const str = (description: string): JsonSchema => ({ type: "string", description });
export const int = (description: string): JsonSchema => ({ type: "integer", description });
export const bool = (description: string): JsonSchema => ({ type: "boolean", description });
export const date = (description: string): JsonSchema => ({
  type: "string",
  format: "date",
  description,
});
export const strs = (description: string): JsonSchema => ({
  type: "array",
  items: { type: "string" },
  description,
});
export const oneOf = (values: string[], description: string): JsonSchema => ({
  type: "string",
  enum: values,
  description,
});
export const obj = (
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  description?: string
): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  ...(description ? { description } : {}),
});

export const BOOK = str("The book's ID (read_books).");
export const UPDATED_AT = str(
  "The `updated_at` you read: an edit made against an older one is refused (409)."
);
export const ACCOUNT = str("An account's full name, like Expenses:Food:Groceries.");
export const AMOUNT = str('A decimal amount, as a string: "12.34".');
