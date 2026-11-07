# shops

Reads shops' order histories for a book, Amazon first, at `/api/shops/v1`, and hands the
charges it reads to `app`, which itemizes them into the book ([the Amazon orders
plan](../../docs/milestones/amazon-orders/PLAN.md)). It signs in to Amazon as the book's manager.
Tests: `tests/` (pytest, run by `pnpm test`).

Amazon has no API for a shopper's orders, so this parses Amazon's own pages through
[amazon-orders](https://github.com/alexdlaird/amazon-orders) (MIT), with its browser extra:
the sign-in is done in a headless Chromium (Playwright), as a person would, which is why the
image is large.

| Route | What it does |
|---|---|
| `GET /health` (and `/api/shops/v1/health`) | Up, its version and schema, and whether it can seal secrets. |
| `GET /books/{book}/amazon` | The connection, without its secrets (whether each is set). Read. |
| `PATCH /books/{book}/amazon` | Change it against the `updated_at` read (null before it exists). Manage. |
| `DELETE /books/{book}/amazon?updated_at=` | Forget it, what was read, and Amazon's session. Manage. |
| `POST /books/{book}/amazon/sync` | Start reading Amazon (202); `GET` says how it's going. Write. |
| `GET /books/{book}/amazon/charges` | What was read, newest first, each charge with its order. Read. |

Roles are the ledger's, asked as the caller (`X-User-Id`, set by the gateway).

## How a sync goes

1. Log in: reuse Amazon's session from last time (`/data/shops/amazon/<book>/cookies.json`),
   or sign in in a headless Chromium as a person would: the email, the password, a two-step
   code made from the authenticator app's setup key, and Amazon's "I am human" box. Anything
   Amazon asks that only a person can answer (an image captcha, a code sent by email or text,
   an approval) stops the sync with what was asked (status `login`), and the page it stopped on
   is kept as `output/signin-failed.png` and `.html` beside the session. The "I am human" box
   is ticked whenever Amazon puts it in front of a page later.
2. Read Amazon's Transactions page back to the connection's `sync_from` (30 days if unset) the
   first time (and after the date, the cards or the account change), else 15 days before the
   last sync:
   each charge to a card, with its date, amount, card and order number. Every card seen is
   noted; only the book's charges are kept (by card: the included ones, or all, never the
   excluded; one with no card always), and ones no longer the book's are forgotten.
3. Read each order behind the book's charges not read before, and any from the last 14 days
   again, one at a time, a second apart: its items, totals, shipments and payment.
4. Hand the book's charges to `app` (`POST /api/app/v1/books/{book}/orders`, as whoever
   synced), each with its lines (`shops.lines`: items, tax, shipping, a gift card or points from
   their accounts), for it to itemize them into the book as receipts. `app` starts the morning's
   sync itself (09:00 in the book's zone).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SHOPS_DATA_DIR` | `/data` | Holds `shops.sqlite`, and Amazon's sessions under `shops/`. |
| `SHOPS_ENCRYPTION_KEY` | `AI_ENCRYPTION_KEY` | Seals the password and setup key (32 bytes, base64). |
| `LEDGER_URL` | `http://ledger:8000` | Where roles are asked. |
| `APP_URL` | `http://app:3000` | Where a sync hands the book its charges. |

## Development

```sh
docker build -t luminous-money/shops:dev .        # or `docker buildx bake shops` at the root
docker build --target uv -t luminous-money-shops-uv .
docker run --rm -u "$(id -u):$(id -g)" -e UV_CACHE_DIR=/tmp/uvc -v "$PWD":/w -w /w luminous-money-shops-uv uv lock
```
