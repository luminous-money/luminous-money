# Luminous Money: accounts

- **Opening** (`write_add_account`): the full name; its root sets its type. Missing levels in
  between are made as nodes. `kind: "node"` makes a node (it holds sub-accounts, never
  transactions); the default is a leaf. An opening balance (an amount on a date) is optional and
  is booked against `Equity:Opening-Balances`. An asset that's revalued (a house, a car) takes
  `revalue_every` (days its value stays current).
- **Names** follow Beancount's rule: parts start with a capital letter or digit, then letters,
  digits, dashes. Title-case words and join them with dashes: `Gifts-and-Giving`.
- **Editing** (`write_edit_account`): display name, description, booking method (FIFO, LIFO,
  HIFO, STRICT to choose lots, NONE for average cost), payment cards, `outflow` (an asset or
  liability whose payments count as spending, as an expense account: a mortgage's principal),
  revaluing. Against its `updated_at`.
- **Renaming or moving** (`write_rename_account`) carries everything under it, and rules,
  schedules, budgets and bank links follow.
- **Archiving** closes it (and its subtree) on a date; a balance left goes to `transfer_to`.
  Archived accounts leave the pickers; their history stays.
- **Divided accounts:** `write_divide_account` turns an asset or liability leaf into parts (it
  becomes a node with the same name, its history moving to its main part); `write_set_divided`
  makes an existing node with sub-accounts one real account. Parts can't be reconciled or linked
  to a bank themselves: the divided account is.
- **Deleting:** `delete_account` for an account with no transactions, or moving them to a
  `substitute`; `delete_account_and_transactions` deletes what's in it too. Check
  `read_purge_preview` first and tell the user what would go.
- **Commodities** (`read_commodities`, `write_set_commodity`): currencies and shares, their
  names and where their prices come from.
