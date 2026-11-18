# Luminous Money: review

What arrives by itself (a bank feed, a file, a schedule, a receipt) is **staged** (`!`) and waits
in review until it's confirmed (`*`). Review is where it gets its category and is checked.

- `read_review_queue` lists staged transactions, oldest first, each with its `proposal` when
  something proposed a category: a **rule**, the book's **history** (how the same payee was
  categorized before) or the book's **AI**. A proposal is already applied to the staged
  transaction; it's there so you can say where the category came from.
- **The common case** is two splits: the **anchor** on the bank or card account (where it came
  from; leave it alone) and the **counterpart**, the category. To categorize, change the
  counterpart's `account` with `write_edit_transaction`, sending all the splits (with the anchor
  as it is), and `flag: "*"` to confirm it at once.
- `write_confirm_transactions` confirms several as they are. Confirming tells the book whether
  its proposal was kept, which teaches history.
- `write_suggest_categories` asks the rules and history again for what isn't categorized (and
  the AI, for the IDs you name, when the book has it set up).
- **Matches:** a bank row may match a transaction already in the books (one entered by hand, or
  a schedule's). `read_matches` lists them with their other candidates; `write_assign_match`
  picks another (or none: it becomes its own transaction), `write_confirm_match` settles it.
- **Transfers:** a move between two of the user's accounts arrives twice (out of one, into the
  other) and is **paired** into one transfer in review. `read_transfers` lists them;
  `write_reject_transfer` undoes a wrong pairing.
- **Rules** (`read_rules`, `write_add_rule`, …) are the user's own "if this, then that": all of
  a rule's conditions must hold (the account imported into, the description's payee key, words
  it contains, an amount range); the most specific matching rule wins. A rule gives the
  category, optionally a clean payee and a fund, and may confirm by itself. After adding or
  changing one, the answer says how many staged transactions it covers: offer
  `write_apply_rule`.
- **Notifications** (`read_notifications`): what needs attention, like a sale no fund was named
  for, or a bank connection to sign in to again.

Don't confirm what the user hasn't seen unless they asked you to; when unsure of a category,
say what you'd choose and why.
