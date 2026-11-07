/**
 * Shops' orders (Amazon orders, step 2), under /books/:book/orders:
 *
 * - `POST /orders` `{charges}`: a shop's reader hands the book its charges (shared/orders.ts);
 *   kept, then read into their transactions in the background (202, with how many were new).
 * - `GET /orders?shop=`: what the book made of each, newest first.
 * - `POST /orders/read`: read the waiting ones now (what's left waiting, and why, is in the list).
 * - `POST /orders/:shop/:id/assign` `{transaction_id}`: read a waiting one (its card in no
 *   account) into a transaction by hand.
 *
 * Changing needs a writer (api.ts's middleware); reading, any member.
 */
import type { Hono } from "hono";

import { add, isDecimal, isZero, negate } from "../../shared/decimal.js";
import type { OrderCharge } from "../../shared/orders.js";
import { LedgerError } from "../ledger.js";
import { OrderProblem, readCharge, readWaiting, type OrderDeps } from "./read.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHOP = /^[a-z0-9-]{1,40}$/;

/** Why a charge as sent can't be kept, or null. */
export function chargeProblem(c: OrderCharge): string | null {
  if (typeof c?.id !== "string" || !c.id || c.id.length > 200) return "a charge needs its `id`";
  if (typeof c.shop !== "string" || !SHOP.test(c.shop))
    return `${c.id}: \`shop\` is a short name, like amazon`;
  if (typeof c.date !== "string" || !DATE.test(c.date)) return `${c.id}: \`date\` is YYYY-MM-DD`;
  if (typeof c.amount !== "string" || !isDecimal(c.amount) || isZero(c.amount))
    return `${c.id}: \`amount\` is a number, negative for a purchase`;
  if (c.card !== null && !/^\d{2,6}$/.test(c.card?.last_four ?? ""))
    return `${c.id}: \`card\` is null or has its \`last_four\``;
  if (!Array.isArray(c.orders) || c.orders.some((o) => typeof o?.number !== "string"))
    return `${c.id}: \`orders\` is a list, each with its \`number\``;
  if (!Array.isArray(c.lines)) return `${c.id}: \`lines\` is a list`;
  for (const l of c.lines)
    if (typeof l?.text !== "string" || typeof l.amount !== "string" || !isDecimal(l.amount))
      return `${c.id}: each line has its \`text\` and \`amount\``;
  const left = c.lines.reduce((sum, l) => add(sum, l.amount), c.amount);
  if (c.lines.length && !isZero(left))
    return `${c.id}: its lines come to ${add(left, negate(c.amount))}, not ${negate(c.amount)}`;
  return null;
}

export function orderRoutes(
  api: Hono<{ Variables: { user: string } }>,
  deps: OrderDeps,
  roleIn: (user: string, book: string) => Promise<string | undefined>
): void {
  const reading = (book: string) =>
    readWaiting(deps, book).catch((error) =>
      console.error(`orders: reading ${book}'s waiting charges failed:`, error)
    );

  api.post("/books/:book/orders", async (c) => {
    const { book } = c.req.param();
    const body = (await c.req.json().catch(() => null)) as { charges?: OrderCharge[] } | null;
    if (!Array.isArray(body?.charges)) return c.json({ detail: "send `{charges: [...]}`" }, 422);
    for (const charge of body.charges) {
      const problem = chargeProblem(charge);
      if (problem) return c.json({ detail: problem }, 422);
    }
    const added = deps.orders.receive(book, c.get("user"), body.charges);
    void reading(book);
    return c.json({ received: body.charges.length, new: added }, 202);
  });

  api.get("/books/:book/orders", async (c) => {
    const { book } = c.req.param();
    if (!(await roleIn(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const shop = c.req.query("shop") || undefined;
    return c.json(deps.orders.charges(book, shop).map(({ user_id: _u, ...charge }) => charge));
  });

  api.post("/books/:book/orders/read", async (c) => {
    const { book } = c.req.param();
    return c.json(await readWaiting(deps, book));
  });

  api.post("/books/:book/orders/:shop/:id/assign", async (c) => {
    const { book, shop, id } = c.req.param();
    const body = (await c.req.json().catch(() => null)) as { transaction_id?: string } | null;
    if (typeof body?.transaction_id !== "string" || !body.transaction_id)
      return c.json({ detail: "name the `transaction_id` to read it into" }, 422);
    const charge = deps.orders.charge(book, shop, id);
    if (!charge) return c.json({ detail: "no such charge" }, 404);
    if (charge.state !== "waiting")
      return c.json({ detail: "it's already itemized into its transaction" }, 409);
    try {
      // As the one assigning it: they're the one who can change the book now.
      const outcome = await readCharge(
        deps,
        book,
        { ...charge, user_id: c.get("user") },
        body.transaction_id
      );
      deps.orders.settle(book, shop, id, outcome.state, outcome.detail, outcome.transaction_id);
      const { user_id: _u, ...saved } = deps.orders.charge(book, shop, id)!;
      return c.json(saved);
    } catch (error) {
      if (error instanceof OrderProblem) return c.json({ detail: error.message }, error.status);
      if (error instanceof LedgerError)
        return c.json({ detail: error.message }, error.status as 404);
      throw error;
    }
  });
}
