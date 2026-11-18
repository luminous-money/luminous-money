# Luminous Money: reconciling

Reconciling checks an account against its statement: the transactions on the statement are
ticked, and together with what was reconciled before they must come to the statement's
balance.

- `read_reconcile` gives what the Reconcile screen does: where it stands (what's reconciled so
  far), the account's transactions through the statement date, the statement's date and balance
  as the bank or the last imported file says them (when known), what starts ticked (what was
  imported, and the opening balance), and any saved draft.
- **Balances are as stored:** a credit card's (a liability's) is negative while money is owed.
- `write_reconcile` finishes: the statement's date and balance, and the IDs ticked. It's refused
  unless they add up. Unconfirmed transactions ticked are confirmed.
- `write_reconcile_draft` saves one to finish later (shared by the book's members), or discards
  it (null).
- A statement holds by its marks, not by dates: a transaction not on the statement stays
  outstanding, whatever its date. `delete_reconciliation` undoes the latest.
- Divided accounts are reconciled as one; their parts can't be.
