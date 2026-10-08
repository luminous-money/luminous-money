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

| Variable | Default | Purpose |
|---|---|---|
| `LEDGER_DATA_DIR` | `/data` | Holds `ledger.sqlite`. |
| `LEDGER_EXPORT_DIR` | unset | Where book exports for Fava are written. |
