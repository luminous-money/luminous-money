# ledger

The system of record for every book, using Beancount as the accounting engine. It's the only
service that writes book data. Served at `/api/ledger/v1`.

## How it works

- **A directive is a row.** The row's `text` column holds the directive's canonical Beancount
  text, which is what Beancount's printer produces for the parsed, unbooked entry, with the
  directive's `id` as its first metadata line. That text is the source of truth, and it's also
  the export format.
- **Other columns are derived from the text, for SQL reads:** `date`, `kind`, `flag`, and a
  `posting` table (account, number, currency). The app's read paths (the review queue, account
  history, the resolver context) are plain SQL and never touch Beancount.
- **The engine renders a book's rows as Beancount text and runs `loader.load_string`.** That's
  Beancount's full public pipeline: parse, booking, plugins and validation. The result is cached
  until the book changes. All Beancount use lives in `src/ledger/engine.py`.
- **Ordering:** rows load in `(date, ordinal)` order. An ordinal is assigned when a directive is
  first stored and kept across edits, so the order of directives within a day is stable.
- **Change log:** every change appends to `change`. Its autoincrementing `seq` is the backup
  cursor. Wall-clock time is recorded but never used for ordering.
- **Deletes leave tombstones** (`deleted = 1`, `text = NULL`), so incremental backups can carry
  them.
- **Import and restore are the same operation.** Both apply Beancount text in which:
  - directives are upserted by `id`, or get a new ID if they don't have one
  - `custom "fava-beans" "deleted" "<id>"` lines delete

  A backup chunk is exactly such text, one per changed book, with the directives in ordinal order.

- **Migrations** (`src/ledger/migrations.py`) are numbered and tracked by `user_version`. Every
  table is created with `create_table`, which adds non-null `created_at`/`updated_at`; a lint
  test enforces it.
- **Versions:** a directive's `updated_at` is its version. Edits send it back, and a
  stale one gets 409. `PATCH /transactions/{id}` changes only the given fields.
- **Accounts:** a plain `open` is a leaf; one with `kind: "node"` is a node. Top-level accounts
  and unopened parents are implicit nodes. New accounts go under nodes only, and postings to
  nodes are refused.

## Demo data

`python -m ledger.demo` prints a demo ledger: a `bean-example` history whose recent card and
checking purchases are staged (`!`, `source: "demo-import"`), about half of them moved to
`Expenses:Uncategorized`. `pnpm seed` at the repo root imports it into a running stack.

## Development

Everything runs in Docker; nothing needs installing on the host.

```sh
docker build --target test -t fava-beans-ledger:test .   # build with dev dependencies
docker run --rm fava-beans-ledger:test                   # run the tests
docker run --rm fava-beans-ledger:test python bench/bench.py --years 20 --copies 5

docker build -t fava-beans-ledger .                      # runtime image
docker run --rm -p 8000:8000 -v ledger-data:/data fava-beans-ledger
# API docs: http://localhost:8000/api/ledger/v1/docs
```

To update dependencies, edit `pyproject.toml`, then refresh the lockfile with the image's own
toolchain:

```sh
docker build --target uv -t fava-beans-uv .
docker run --rm -u "$(id -u):$(id -g)" -e UV_CACHE_DIR=/tmp/uvc -v "$PWD":/w -w /w fava-beans-uv uv lock
```

To build for the Pi (or both architectures):
`docker buildx build --platform linux/arm64,linux/amd64 .`

## Configuration

| Variable          | Default | Purpose                |
| ----------------- | ------- | ---------------------- |
| `LEDGER_DATA_DIR` | `/data` | Holds `ledger.sqlite`. |
