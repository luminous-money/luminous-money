# Luminous Money: imports

- Transactions arrive from **files** (a bank's CSV, imported in the app) and **bank feeds**
  (SimpleFIN: the user's banks, linked to accounts). Everything arrives staged, for review,
  with rules and history applied; a row that matches a transaction already in the books is
  matched to it.
- `read_imports` lists imports, newest first; `read_import` shows one's rows and what each
  became.
- `read_bank_feeds` lists the bank connections the book sees (the user's own, and those another
  member shared with it, only the accounts shared) and, for the book's linked accounts, what
  each bank reports (its balance) and how syncing is going. A connection syncs by itself daily;
  `write_sync_bank_feed` syncs it now (any writer may: it spends its owner's daily requests).
- Linking a bank, sharing a connection with a book, or importing a file is done in the app.
