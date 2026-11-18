# Luminous Money: receipts

- A transaction can have files attached (receipts, statements): `read_attachments`.
- `write_read_receipt` reads an attached receipt into its transaction with the book's AI: the
  merchant, date and total are checked against it, and its lines become splits (`itemize`, or
  one split), categorized by the book's rules, history and AI. The transaction goes back to
  review. It takes a minute or more, so it runs as a job: poll `read_job` until it's `done` or
  `failed`, then show the user what it made.
- The book's AI must be set up (in the app) for reading to work.
- **Amazon** (`read_orders`): charges read from the user's Amazon account, each itemized into its
  card transaction (each item a split, its title the memo), or waiting for one.
  `write_assign_order` itemizes a waiting charge into the transaction it is.
- Sending a new receipt or file in isn't possible here yet: the user can capture one in the app.
