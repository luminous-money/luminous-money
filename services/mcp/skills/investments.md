# Luminous Money: investments

- A brokerage account holds **commodities** (shares: `VTI`) as **lots**, each with its cost.
  `read_holdings` gives units, prices, value, cost basis, gains and lots for an account and
  everything under it.
- **Trades** (`write_trade`): `kind` `buy`, `sell` or `dividend`, the `commodity`, `units` and
  `price` (per unit, in the book's currency), `fees`. The ledger writes the transaction: cash
  from `cash_account`, shares into `holding_account` (by default the account itself if it's a
  leaf, else `<account>:Cash` and `<account>:<COMMODITY>`), gains to income. A sale books lots
  by the account's booking method; with STRICT, name the `lots`. A dividend is `amount`, and
  `units` if reinvested. `read_trade_preview` shows the transaction without writing it.
- **Prices:** `read_prices` for a commodity's history, `write_add_price` to record one,
  `write_fetch_prices` to fetch the latest now (the book does each morning).
- **Revalued assets** (a house, a car) aren't priced by the market: `write_revalue` records what
  one is worth on a date, and the change goes to its gains.
- Funds can hold shares too (the funds skill).
