The categorizer API (v1)
==================================================================================================

How fava-beans asks an outside service, a **categorization provider**, what imported
transactions are. A provider might be an LLM (such as Cati), a hosted service, or a script. The
canonical types are in
[`services/app/src/shared/categorizer-api.ts`](../services/app/src/shared/categorizer-api.ts);
this document explains them.

fava-beans is the system of record, so it defines this API. Providers **only propose**: they
never write to the books, and what they propose goes through review like anything else.

## How a provider fits in

When rows are imported (or "Suggest categories" is used in review), fava-beans runs a chain of
categorizers over the transactions it's about to stage:

1. **`rules`** (built in): the user's own rules.
2. **`history`** (built in): what the same payee was categorized as before.
3. **Providers**, in the order configured.

Each categorizer is asked only about the transactions not yet **settled**: a transaction is
settled once some categorizer proposes postings for it with confidence **0.9 or more**. When the
chain is done, the most confident postings and the most confident payee are applied, whatever
the confidence (weak proposals get corrected in review). Ties go to the earlier categorizer.

The built-in categorizers implement this same contract, so a provider is a peer, not an
afterthought. The one thing only a built-in can do is confirm a transaction automatically (a
user's rule, with "confirm automatically" ticked); a provider's proposals always wait for review.

## Configuring providers

Per installation, with the `CATEGORIZERS` environment variable on the `app` service: a JSON
list, run in this order.

```sh
CATEGORIZERS='[
  {"name": "cati", "url": "http://cati:8080", "token": "s3cret", "timeout_ms": 30000, "feedback": true}
]'
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Unique, and not `rules` or `history`. Shown in review as where a proposal came from, and used for acceptance rates. |
| `url` | yes | The provider's base URL. The endpoints below are relative to it. |
| `token` | no | Sent as `Authorization: Bearer <token>`. |
| `timeout_ms` | no | How long to wait for an answer. Default 30000. |
| `feedback` | no | Send the provider feedback on its proposals (below). Default false. |

A bad configuration stops `app` at startup, rather than quietly categorizing less.

## Conventions

- **JSON, snake_case**, over HTTP `POST` with `Content-Type: application/json`.
- **Money is a decimal string** with its currency: `{"number": "-4.50", "currency": "USD"}`.
  Never a float.
- **Dates are ISO**: `"2024-03-05"`.
- **Signs:** an amount is the change to its account. Money leaving a bank account is negative.
- **Accounts** are Beancount names: `Expenses:Food:Coffee`. Propose only open **leaf** accounts
  from the request's chart of accounts.
- **`api_version`** is `"1"`. Additions that don't change meaning keep the version; providers
  should ignore fields they don't know.

## `POST <url>/v1/categorize`

### Request

```json
{
  "api_version": "1",
  "request_id": "7d0c2f…",
  "book": { "id": "b1", "name": "Kael Personal" },
  "transactions": [
    {
      "id": "batch42:0",
      "date": "2024-03-05",
      "account": "Assets:Bank:Checking",
      "amount": { "number": "-4.50", "currency": "USD" },
      "description": "POS DEBIT 0412 CORNER CAFE #42 CHICAGO IL",
      "payee": null
    }
  ],
  "context": {
    "from": "2023-01-05",
    "accounts": [
      { "name": "Expenses:Food:Coffee", "type": "expense", "kind": "leaf", "open": "2020-01-01", "close": null }
    ],
    "history": [
      {
        "id": "a1b2…",
        "date": "2024-02-12",
        "flag": "*",
        "payee": "Corner Cafe",
        "narration": "POS DEBIT 0398 CORNER CAFE #42 CHICAGO IL",
        "postings": [
          { "account": "Assets:Bank:Checking", "amount": { "number": "-3.75", "currency": "USD" } },
          { "account": "Expenses:Food:Coffee", "amount": { "number": "3.75", "currency": "USD" } }
        ]
      }
    ]
  }
}
```

- **`transactions`:** what to categorize. `id` is opaque and only meaningful within this request.
  `account` is the account it was imported into; `amount` is the change to it; `description` is
  the bank's text as given; `payee` is set only if the bank gave one separately.
- **`context.accounts`:** the book's chart of accounts. `kind` is `leaf` (holds transactions) or
  `node` (only holds other accounts).
- **`context.history`:** every transaction in the book from `context.from` on: the 14 months
  before the earliest transaction in the request, and anything after, from all accounts, never
  sampled. **Learn from `flag: "*"`** (confirmed by the user); `"!"` is still waiting for review.
  A posting's `amount` is null only where the ledger can't say without full booking (lots,
  prices).

The context is the same for every provider in a run, and can be large (thousands of
transactions). It's the user's financial history: run providers you trust with it.

### Response

```json
{
  "proposals": [
    {
      "id": "batch42:0",
      "postings": [{ "account": "Expenses:Food:Coffee" }],
      "payee": "Corner Cafe",
      "confidence": 0.86,
      "reason": "Corner Cafe has been coffee 12 times in the last year"
    }
  ]
}
```

- **Any subset** of the transactions: leave out the ones you have nothing for.
- **`postings`** (optional): the other side of the transaction, everything but the imported
  account.
  - **One posting without an amount** takes the whole amount: the common case.
  - **Several postings** (a split, e.g. a shop's charge as groceries and household) need
    amounts in the transaction's currency that sum to the negative of the transaction's amount.
- **`payee`** (optional): a clean name for the payee. The bank's text stays the description.
- **`confidence`:** 0 to 1, meant as the **chance the user accepts the proposal unchanged**. At
  0.9 or more, the transaction is settled and later providers aren't asked.
- **`reason`:** one short sentence, shown in review next to the proposal.

A proposal with only a `payee` is fine: it's merged with another categorizer's postings.

**Transactions with several splits to place** (an itemized receipt, M16) are asked about with
the same fields: the transaction's account and amount as a whole. A proposal for one is taken
as its **fallback**, the account for any split nothing else places: it must be one posting
without an amount, and it doesn't settle the transaction (fava-beans' own item history and AI
place the splits themselves). Nothing about the API changed for them: it's still version 1.

### What fava-beans checks

A proposal is dropped (and logged) if it names a transaction that wasn't asked about, gives a
confidence outside 0 to 1, proposes an account that isn't an open leaf (or is the imported
account itself), or proposes a split that doesn't balance. The rest of the response still
counts.

### Failures

Any non-2xx status, an unreadable answer, or no answer within `timeout_ms` skips the provider for
this run. The import goes on with the other categorizers' proposals.

## `POST <url>/v1/feedback`

Sent only to providers configured with `"feedback": true`, when the user confirms a transaction
whose applied postings came from that provider. Use it to learn; the answer's body is ignored,
and failures are only logged.

```json
{
  "api_version": "1",
  "book": { "id": "b1", "name": "Kael Personal" },
  "outcomes": [
    {
      "request_id": "7d0c2f…",
      "id": "batch42:0",
      "proposal": { "id": "batch42:0", "postings": [{ "account": "Expenses:Food:Coffee" }], "confidence": 0.86, "reason": "…" },
      "final": {
        "payee": "Corner Cafe",
        "postings": [{ "account": "Expenses:Food:Coffee", "amount": null }]
      },
      "accepted": true
    }
  ]
}
```

- **`request_id` and `id`** say which request and transaction the proposal answered.
- **`final`** is what the user confirmed: the payee, and the other side's postings.
- **`accepted`** is whether the proposal's postings were kept (same accounts).

## Acceptance

fava-beans records, per categorizer, how many of its applied proposals were confirmed unchanged,
and shows the rate on the Rules page. A provider whose `confidence` doesn't match how often it's
accepted shows up there as poorly calibrated.

## Writing a provider

The smallest useful provider answers every request with an empty list and works its way up:

```ts
import { createServer } from "node:http";

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  const proposals = req.url === "/v1/categorize" ? categorize(request) : [];
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ proposals }));
}).listen(8080);
```

The unit tests in `services/app/src/server/categorize/categorize.test.ts` drive a provider like
this over real HTTP, and are a good reference for what's sent and what's accepted.
