"""The API's JSON shapes. These become the OpenAPI schema, and from it the TypeScript client.

Numbers are decimal strings, never JSON numbers, so amounts can't pick up floating-point error
anywhere between a form field and the ledger. Metadata values carry their Beancount type (text,
boolean, number, date, amount), so reading a transaction, editing it and writing it back loses
nothing.

JSON field names are snake_case, the same as everywhere else.

Every edit carries the `updated_at` it read: the version. If the stored version has moved on, the
edit is refused with 409 Conflict rather than overwriting someone else's change.
"""

from __future__ import annotations

import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DecimalStr = Annotated[str, StringConstraints(pattern=r"^-?\d+(\.\d+)?$")]
Flag = Annotated[str, StringConstraints(min_length=1, max_length=1)]


class Api(BaseModel):
    pass


class Strict(Api):
    model_config = ConfigDict(extra="forbid")


Version = Annotated[
    str,
    Field(
        description="The `updated_at` this edit was based on. If the stored one differs, the edit is "
        "refused with 409 Conflict."
    ),
]


class Amount(Strict):
    number: DecimalStr
    currency: str


class Cost(Strict):
    """A cost basis, as written in `{...}`. All fields empty is `{}`: let booking pick the lot."""

    number: DecimalStr | None = Field(None, description="Per-unit cost.")
    total: DecimalStr | None = Field(None, description="Total cost, as in `{{...}}`.")
    currency: str | None = None
    date: datetime.date | None = None
    label: str | None = None


class MetaNumber(Strict):
    number: DecimalStr


class MetaDate(Strict):
    date: datetime.date


MetaValue = str | bool | MetaNumber | MetaDate | Amount
Meta = dict[str, MetaValue]


class Posting(Strict):
    account: str
    units: Amount | None = Field(None, description="Omit to let booking fill in the balancing amount.")
    cost: Cost | None = None
    price: Amount | None = Field(None, description="Per-unit price, as in `@`.")
    flag: Flag | None = None
    meta: Meta = Field(default_factory=dict)


# Beancount's `#tag`, without the `#` (M17)
Tag = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9\-_/.]+$")]


class FundLine(Strict):
    """What a transaction does to one fund (Funds A): `+` puts money into it, `-` takes it out.
    Unallocated is never a line: it's what isn't in a fund."""

    fund: str = Field(min_length=1, max_length=60)
    amount: Amount = Field(description="Signed: positive into the fund, negative out of it.")


FUNDS_DESCRIPTION = (
    "Its fund lines (Funds A). Money in goes to funds (`+`), money out comes from them (`-`), and a "
    "transfer puts money toward them (`+`, and with More options `-` too); together they're no more "
    "than the transaction. Checked only when they change."
)


class TransactionIn(Strict):
    date: datetime.date
    flag: Flag = Field("!", description="`!` is staged for review; `*` is confirmed.")
    payee: str | None = None
    narration: str = ""
    tags: list[Tag] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    funds: list[FundLine] | None = Field(None, description=FUNDS_DESCRIPTION)
    meta: Meta = Field(default_factory=dict)
    postings: list[Posting] = Field(min_length=1)


class Transaction(TransactionIn):
    id: str
    created_at: str
    updated_at: str = Field(description="Changes on every write; send it back with edits.")
    attachments: int = Field(0, description="How many files it holds (M16): a receipt, say.")


class Attachment(Api):
    """A file a transaction holds (M16). Its bytes: `GET /books/{b}/attachments/{id}`."""

    id: str
    transaction_id: str
    filename: str
    content_type: str
    size: int
    sha256: str
    created_at: str


class TransactionUpdate(TransactionIn):
    """A full replacement."""

    updated_at: Version


class Deletion(Strict):
    id: str
    updated_at: Version


class TransactionPatch(Strict):
    """Change only the fields given. `postings`, when given, replaces all of them."""

    updated_at: Version
    date: datetime.date | None = None
    flag: Flag | None = None
    payee: str | None = None
    narration: str | None = None
    tags: list[Tag] | None = None
    links: list[str] | None = None
    funds: list[FundLine] | None = Field(None, description="Replaces all its fund lines (Funds A); [] or null clears them.")
    meta: Meta | None = None
    postings: list[Posting] | None = Field(None, min_length=1)


class TransactionEdit(TransactionPatch):
    """A patch to one transaction, by ID, against the version read."""

    id: str


class TransactionChanges(Strict):
    """Transactions to create, change and delete, in one write: all of it, or none."""

    create: list[TransactionIn] = Field(default_factory=list)
    update: list[TransactionEdit] = Field(default_factory=list, description="Each with the version read.")
    delete: list[Deletion] = Field(default_factory=list, description="Each with the version read.")


AccountType = Literal["asset", "liability", "equity", "income", "expense"]
AccountKind = Literal["leaf", "node"]
CardBrand = Literal["visa", "mastercard", "amex", "discover", "other"]


class Card(Strict):
    """A payment card an account is paid with (M16), so a receipt's card names its account."""

    brand: CardBrand | None = Field(None, description="None: any brand (the last four alone).")
    last_four: str = Field(pattern=r"^\d{4}$")



class Account(Api):
    name: str
    type: AccountType | None = Field(description="From the top-level account; None for an unrecognized root.")
    kind: AccountKind = Field(description="Leaf accounts hold transactions; node accounts hold sub-accounts.")
    implicit: bool = Field(
        False,
        description="Never opened: a top-level account, or a parent that exists because accounts exist under it. Always a node.",
    )
    open: datetime.date | None = None
    close: datetime.date | None = None
    currencies: list[str] = Field(default_factory=list, description="Constraint from the open directive; empty means any.")
    display_name: str | None = Field(None, description="A human name, from `display-name` metadata if set.")
    description: str | None = Field(None, description="What the account is for, in words: `description` metadata.")
    booking: str | None = Field(
        None, description="How sales pick lots (FIFO, LIFO, HIFO, STRICT for specific lots, NONE for average cost); "
        "None: the book's default."
    )
    revalue_every: int | None = Field(
        None, description="A revalued asset (a house, a car): how many days its value stays current."
    )
    divided: bool = Field(
        False,
        description="A divided account: a node that's one real account (at a bank, say), its sub-accounts dividing "
        "what's in it. It's reconciled and linked as one; they can't be themselves.",
    )
    main_part: str | None = Field(
        None, description="A divided account's part that what comes in from the bank or a file lands in (M15)."
    )
    cards: list[Card] = Field(
        default_factory=list, description="An asset or liability account's payment cards (M16): a receipt's card names it."
    )
    outflow: str | None = Field(
        None,
        description="An asset or liability that counts as spending (Loans): the expense account what's paid into it "
        "counts as; expenses paid out of it don't count again. Its subtree too.",
    )
    updated_at: str | None = Field(None, description="Its `open` directive's version; send it back to change settings.")


class TreeAccount(Account):
    """An account in the chart of accounts, with its balances."""

    balance: list[Amount] = Field(description="Its own balance (a node: none), unconfirmed included.")
    total: list[Amount] = Field(description="Its subtree's balance, itself included: one amount per currency.")
    value: Amount = Field(description="The subtree's value in the operating currency: everything that has a price.")
    unpriced: list[str] = Field(default_factory=list, description="Commodities in the subtree with no price, left out of `value`.")
    splits: int = Field(description="How many splits its subtree has: what deleting it would move.")
    protected: bool = Field(
        False, description="A top-level, system or brokerage-part account: it can't be renamed or deleted."
    )


class AccountRename(Strict):
    to: str = Field(description="The new full name (same top-level account).")
    updated_at: Version | None = Field(None, description="The open directive's version read (implicit nodes have none).")


class AccountArchive(Strict):
    date: datetime.date | None = Field(None, description="When it closes; default today. No earlier than its last transaction.")
    transfer_to: str | None = Field(None, description="Move what's left in it here first (a closing transfer).")
    updated_at: Version | None = None


class AccountSummary(Account):
    """An account with what a card or a ledger's header shows."""

    balance: list[Amount] = Field(
        description="The current balance, unconfirmed transactions included: one amount per currency held."
    )
    as_of: datetime.date | None = Field(
        description="The date of its opening balance, which includes everything up to then (imports skip rows up "
        "to it); None without one."
    )
    value: Amount | None = Field(None, description="Market value in the book's operating currency; None if unpriced.")
    gain: Amount | None = Field(None, description="Unrealized gain (or loss) on holdings with a cost basis.")
    value_as_of: datetime.date | None = Field(None, description="The oldest price behind `value`.")
    stale: bool = Field(False, description="A price (or a revalued asset's value) is older than it should be.")
    revalued_on: datetime.date | None = Field(None, description="A revalued asset's last revaluation (or opening).")


class Lot(Api):
    units: str
    cost: Amount
    date: datetime.date | None
    label: str | None = None


class Holding(Api):
    commodity: str
    name: str | None = None
    units: str
    price: Amount | None = Field(description="The latest price, in the operating currency; None for that currency itself.")
    price_date: datetime.date | None
    stale: bool
    value: Amount | None
    cost: Amount | None = Field(description="Total cost basis of its lots; None for cash.")
    gain: Amount | None
    lots: list[Lot]


class Holdings(Api):
    """What an account (and everything under it) holds."""

    account: str
    currency: str = Field(description="The valuation currency: the book's operating currency.")
    holdings: list[Holding]
    value: Amount | None
    gain: Amount | None
    as_of: datetime.date | None = Field(description="The oldest price behind `value`.")
    stale: bool


class PriceIn(Strict):
    date: datetime.date
    commodity: str = Field(pattern=r"^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$")
    price: Amount = Field(description="What one unit was worth, in a currency.")


class PriceOut(Api):
    id: str
    date: datetime.date
    commodity: str
    price: Amount


class FetchResult(Api):
    fetched: list[PriceOut] = Field(description="The latest price of each commodity fetched (recorded unless already there).")
    errors: dict[str, str] = Field(description="Commodity to why its price couldn't be fetched.")


class PricesOnIn(Strict):
    """Days a commodity's price is wanted on (a trade's day, in a brokerage's history)."""

    commodity: str = Field(pattern=r"^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$")
    dates: list[datetime.date] = Field(max_length=400)
    symbol: str | None = Field(
        None,
        pattern=r"^[A-Za-z0-9.^=-]{1,24}$",
        description="Its ticker at the default source, for a commodity that names no source of its own.",
    )


class PriceOn(Api):
    date: datetime.date
    price: Amount | None = Field(description="Its price that day (or the last trading day before), if one could be had.")
    source: Literal["book", "fetched"] | None


class CommodityOut(Api):
    currency: str
    declared: bool = Field(description="Has a `commodity` directive (else only held or priced).")
    name: str | None
    price_source: str | None = Field(description='Where prices are fetched from, as beanprice reads it: "USD:yahoo/VTI".')
    stale_after: int = Field(description="Days before its price counts as stale.")
    price: Amount | None = Field(description="The latest price, in the operating currency.")
    price_date: datetime.date | None
    updated_at: str | None = Field(description="Its `commodity` directive's version; send it back to change it.")


class CommodityIn(Strict):
    name: str | None = None
    price_source: str | None = None
    stale_after: int | None = Field(None, ge=1)
    updated_at: str | None = Field(None, description="Required when it's already declared.")


class LotRef(Strict):
    """A lot to sell from, for an account that sells specific lots."""

    date: datetime.date
    cost: DecimalStr = Field(description="Its per-unit cost.")
    units: DecimalStr


class TradeIn(Strict):
    """A trade, as the forms describe it: the ledger writes the transaction."""

    kind: Literal["buy", "sell", "dividend"]
    date: datetime.date
    commodity: str = Field(pattern=r"^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$")
    units: DecimalStr | None = Field(None, description="Bought or sold; for a dividend, units reinvested (if any).")
    price: DecimalStr | None = Field(None, description="Per unit, in the operating currency.")
    amount: DecimalStr | None = Field(None, description="A dividend's amount.")
    fees: DecimalStr | None = None
    cash_account: str | None = Field(None, description="Default: the account itself (a leaf), or <node>:Cash.")
    holding_account: str | None = Field(None, description="Default: the account itself (a leaf), or <node>:<COMMODITY>.")
    lots: list[LotRef] | None = Field(None, description="For an account that sells specific lots (STRICT).")
    narration: str | None = None
    funds: list[FundLine] | None = Field(
        None, description="The trade's fund lines (Funds B), checked as any transaction's are."
    )


class DrawnLot(Api):
    """A lot a sale draws on."""

    units: str
    cost: Amount = Field(description="Per unit.")
    date: datetime.date | None
    label: str | None = None
    term: Literal["short", "long"]
    gain: Amount


class TradePreview(Api):
    transaction: TransactionIn
    lots: list[DrawnLot]
    opens: list[str] = Field(description="Accounts the trade will open.")


class RevalueIn(Strict):
    """A revalued asset's value on a date."""

    date: datetime.date
    value: Amount


Booking = Literal["FIFO", "LIFO", "HIFO", "STRICT", "NONE"]


class AccountPatch(Strict):
    """An account's settings to change; only those sent."""

    updated_at: str
    display_name: str | None = Field(None, max_length=100, description="A human name; None or \"\": the name's last part.")
    description: str | None = Field(
        None, max_length=500, description="What the account is for, one line; None or \"\": none."
    )
    booking: Booking | None = Field(
        None, description="FIFO, LIFO, HIFO, STRICT (choose lots), NONE (average cost, booked by luminous-money); "
        "None: the book's default."
    )
    revalue_every: int | None = Field(None, ge=1, description="A revalued asset: days its value stays current; None: not one.")
    divided: bool | None = Field(
        None,
        description="An asset or liability node: make it a divided account, one real account its sub-accounts "
        "divide (they can't be reconciled, linked or divided themselves).",
    )
    main_part: str | None = Field(
        None, description="A divided account's main part: one of its parts, where what comes in lands."
    )
    cards: list[Card] | None = Field(
        None,
        max_length=20,
        description="An asset or liability account's payment cards (a divided account's on the whole); "
        "each card is one account's.",
    )
    outflow: str | None = Field(
        None,
        description="An asset or liability: count what's paid into it as spending, as this expense account (an open "
        "leaf), and mask the expenses paid out of it (Loans). None or \"\": it doesn't count.",
    )


class PurgeAffected(Api):
    """Another account a purge changes: its splits in the transactions that go."""

    account: str
    transactions: int
    change: list[Amount] = Field(description="What its balance changes by when they go.")
    reconciled: int = Field(description="How many of its splits among them are reconciled.")


class PurgePreview(Api):
    """What deleting an account with its transactions does, before it's done."""

    accounts: list[str] = Field(description="The accounts deleted: it and its subtree.")
    transactions: int = Field(description="How many transactions go with them.")
    affected: list[PurgeAffected] = Field(description="The other accounts those transactions touch.")


class PurgeIn(Strict):
    updated_at: str | None = Field(None, description="The account's version, as read.")


class Purged(Api):
    accounts: list[str]
    transactions: list[str] = Field(description="The IDs of the transactions deleted.")


class OpeningHolding(Strict):
    """A holding to open an account with."""

    commodity: str = Field(pattern=r"^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$")
    units: DecimalStr
    cost: DecimalStr | None = Field(
        None, description="Its total cost basis, in the operating currency; None: unknown (the price on the date is used)."
    )


class OpeningBalance(Strict):
    """An account's balance on a date, from a statement: recorded as an opening-balance transaction."""

    amount: DecimalStr = Field(description="The balance at the end of `date`, as stored (negative on a liability).")
    currency: str = "USD"
    date: datetime.date


class CompactPosting(Api):
    account: str
    amount: Amount | None = Field(description="The posting's change to its account; None if only booking could say.")
    reconciled: datetime.date | None = Field(None, description="The statement it was reconciled with (M14).")
    flag: str | None = Field(None, description="`!`: a split still to confirm (M16).")
    memo: str | None = Field(None, description="What the split is, in words (a receipt's line) (M16).")
    outflow_of: str | None = Field(
        None,
        description="In the outflows lens, a split that isn't in the books: spending paid into this account, which "
        "counts as spending (Loans).",
    )


class CompactTransaction(Api):
    """A transaction with only what categorizers use: who, when, and where the money went."""

    id: str
    date: datetime.date
    flag: str
    payee: str | None
    narration: str | None
    budgeted: bool = Field(True, description="False with `budget: FALSE`: kept out of budgets (M11).")
    tags: list[str] = Field(default_factory=list, description="Its tags, sorted (M17).")
    funds: list[FundLine] = Field(default_factory=list, description="Its fund lines (Funds A).")
    postings: list[CompactPosting]


class LedgerRow(Api):
    """One transaction, as one account's ledger shows it."""

    id: str
    date: datetime.date
    flag: str
    payee: str | None
    narration: str | None
    amount: Amount | None = Field(
        description="The account's change in this transaction, if it's in one currency; None for several, or if only "
        "booking could say."
    )
    balance: Amount | None = Field(description="The account's running balance in `amount`'s currency, unconfirmed included.")
    amounts: list[Amount] = Field(
        default_factory=list,
        description="The account's change in every currency (a buy: cash out, shares in); empty if only booking could say.",
    )
    balances: list[Amount] = Field(
        default_factory=list,
        description="The running balance in every currency held so far; empty once only booking could say.",
    )
    counterpart: str | None = Field(description="The other split's account, for a two-split transaction; None for more.")
    splits: int
    tags: list[str] = Field(default_factory=list, description="Its tags, sorted (M17).")
    funds: list[FundLine] = Field(default_factory=list, description="Its fund lines (Funds A).")
    reconciled: datetime.date | None = Field(
        None, description="Once all its postings in the account are reconciled: the (latest) statement's date."
    )
    parts: list[CompactPosting] = Field(
        default_factory=list,
        description="A node's ledger (a divided account's, say): each of its postings to an account under it (M15).",
    )
    updated_at: str


class LedgerPage(Api):
    rows: list[LedgerRow] = Field(description="Newest first.")
    next_cursor: str | None = Field(description="Pass as `cursor` for the next (older) page; None at the end.")
    prev_cursor: str | None = Field(
        description="Pass as `after` for the page before (newer); None when this page starts at the newest."
    )


# Budgets (M11)

BudgetUnit = Literal["day", "week", "month", "year"]


class BudgetIn(Strict):
    start: datetime.date = Field(
        description="Its first period's first day, where its periods count from. The account's version starting "
        "then is replaced."
    )
    amount: DecimalStr = Field(description="Per period, in the operating currency. 0 ends the budget from `start`.")
    every: int = Field(1, ge=1, le=1000)
    unit: BudgetUnit
    updated_at: str | None = Field(
        None, description="When a version starts on `start` already: the `updated_at` read (409 when stale)."
    )


class Budget(Api):
    """One version of an account's budget: an amount per period, from `start` until its next version."""

    id: str
    account: str
    start: datetime.date
    amount: Amount
    every: int
    unit: BudgetUnit
    updated_at: str


class BudgetOther(Api):
    """What a budgeted node keeps for itself: its budget less the budgets under it, and its flow less theirs."""

    budget: Amount
    spent: Amount
    left: Amount


class BudgetLine(Api):
    account: str
    type: AccountType | None
    kind: Literal["limit", "goal"] = Field(description="An expense budget is a limit; any other, a goal.")
    version: Budget = Field(description="The version in force.")
    period_start: datetime.date
    period_end: datetime.date = Field(description="The day after the period's last.")
    budget: Amount = Field(description="Per period, or per month with `basis=month`.")
    spent: Amount = Field(
        description="The account's flow over the period, its subtree and unconfirmed transactions included, as "
        "it reads: spent, earned, put in or paid down."
    )
    unconfirmed: Amount = Field(description="The part of `spent` not yet confirmed.")
    left: Amount
    other_currencies: list[Amount] = Field(description="Flows in other currencies, which don't count.")
    other: BudgetOther | None = Field(description="When budgets under it take some of it.")
    problems: list[str] = Field(description="More than a budget over it (after a move), or over-allocated.")


class BudgetSummary(Api):
    """The highest-level expense budgets, per month, against this calendar month's spending under them."""

    month_start: datetime.date
    budget: Amount
    spent: Amount


class BudgetStatus(Api):
    on: datetime.date
    basis: Literal["period", "month"]
    lines: list[BudgetLine] = Field(description="Every budget in force, by account.")
    summary: BudgetSummary | None


class JournalRow(Api):
    """One transaction in the book's journal (every account's), compactly."""

    id: str
    date: datetime.date
    flag: str
    payee: str | None
    narration: str | None
    budgeted: bool
    tags: list[str] = Field(default_factory=list, description="Its tags, sorted (M17).")
    funds: list[FundLine] = Field(default_factory=list, description="Its fund lines (Funds A).")
    postings: list[CompactPosting]
    reconciled: bool | None = Field(
        None, description="Whether its asset and liability postings are all reconciled; None when it has none."
    )
    updated_at: str


class TagUse(Api):
    """A tag the book's transactions have (M17): a tag exists while one does."""

    name: str
    transactions: int = Field(description="How many transactions have it.")
    first: datetime.date = Field(description="The earliest of their dates.")
    last: datetime.date = Field(description="The latest of their dates.")


class JournalPage(Api):
    rows: list[JournalRow] = Field(description="Newest first.")
    next_cursor: str | None = Field(description="Pass as `cursor` for the next (older) page; None at the end.")
    prev_cursor: str | None = Field(
        description="Pass as `after` for the page before (newer); None when this page starts at the newest."
    )


# Reconciliation (M14)


class ReconcileItem(Api):
    """An unreconciled transaction, as reconciling an account lists it."""

    id: str
    date: datetime.date
    flag: str
    payee: str | None
    narration: str | None
    amount: Amount = Field(description="Its unreconciled change to the account (and those under it), as stored.")
    counterpart: str | None = Field(description="The account on its other side, if just one.")
    opening: bool = Field(description="An opening balance: it came from a statement too.")
    updated_at: str


class ReconcileState(Api):
    """What reconciling an account needs."""

    account: str
    currency: str = Field(description="What it's reconciled in: its currency, else the book's.")
    reconciled_balance: Amount = Field(description="What's reconciled so far: the starting balance.")
    last: datetime.date | None = Field(description="The last statement's date; the next must be later.")
    transactions: list[ReconcileItem] = Field(
        description="Unreconciled, oldest first: to `through` and the days after it (all, without it)."
    )
    internal: int = Field(description="Transfers between its sub-accounts, to `through`, that reconcile themselves.")


class ReconcileIn(Strict):
    statement_date: datetime.date
    balance: DecimalStr = Field(description="The statement's ending balance, as stored (negative on a liability).")
    transactions: list[str] = Field(description="The unreconciled transactions on the statement.")
    automatic: bool = Field(
        False,
        description="Reconciled with the bank's balance after a sync. It replaces the latest reconciliation if "
        "that was automatic too and in the same month, so there's one a month.",
    )


class Reconciliation(Api):
    """A statement the account was reconciled with, or a balance assertion on it (from an imported book)."""

    id: str
    account: str
    statement_date: datetime.date = Field(description="The day it holds at the end of.")
    balance: Amount
    statement: bool = Field(description="A reconciliation (else a balance assertion from an imported book).")
    automatic: bool = Field(False, description="Reconciled with the bank's balance after a sync.")
    transactions: int = Field(description="How many transactions it reconciled.")
    off_by: Amount | None = Field(
        description="When they don't agree, the statement less the books: for a statement, what's reconciled with "
        "it and before; for an assertion, everything dated up to it."
    )
    updated_at: str


class Reconciled(Api):
    reconciliation: Reconciliation
    confirmed: list[str] = Field(description="Unconfirmed transactions confirmed with it.")


class Reconciliations(Api):
    account: str
    reconciliations: list[Reconciliation] = Field(description="Newest first.")


class DayBalance(Api):
    date: datetime.date
    balance: DecimalStr


class DayBalances(Api):
    """An account's (and its subtree's) balance at the end of each day it changed."""

    account: str
    currency: str
    before: DecimalStr = Field(description="At the end of the day before `from`.")
    days: list[DayBalance]


class DividePart(Strict):
    name: str = Field(description="The part's name (one segment: \"Padding\"), under the account.")
    amount: DecimalStr = Field(description="What it starts with, moved from the main part, as stored.")


class DivideIn(Strict):
    """Divide an account (M15): it becomes a divided account of the same name, everything that was
    its own going to its main part, and the other parts given their amounts by one transfer."""

    main: str = Field("General", description="The main part's name (one segment), where its history goes.")
    parts: list[DividePart] = Field(default_factory=list)
    date: datetime.date = Field(description="When the other parts get their amounts.")
    updated_at: Version


class AccountIn(Strict):
    name: str = Field(
        description="The fully qualified name. Its root sets the type. Its nearest existing ancestor must be a "
        "node; missing levels in between become implicit nodes."
    )
    kind: AccountKind = "leaf"
    open: datetime.date | None = Field(
        None,
        description="Defaults to the opening balance's date if there is one, else when the nearest opened "
        "ancestor opened, else the earliest account under it, else the book's first entry.",
    )
    opening_balance: OpeningBalance | None = Field(
        None, description="A leaf's balance on a date, recorded as an opening-balance transaction."
    )
    opening_holdings: list[OpeningHolding] = Field(
        default_factory=list, description="Holdings on the opening balance's date (it's required with these)."
    )
    booking: Booking | None = None
    revalue_every: int | None = Field(None, ge=1, description="A revalued asset (a house, a car): days its value stays current.")
    display_name: str | None = Field(None, max_length=100, description="A human name; None or \"\": the name's last part.")
    description: str | None = Field(None, max_length=500, description="What the account is for, one line.")


class Directive(Api):
    """Any directive, as its canonical Beancount text plus the columns derived from it."""

    id: str
    date: datetime.date
    kind: str
    flag: str | None
    text: str
    created_at: str
    updated_at: str = Field(description="Changes on every write; send it back with edits.")


Role = Literal["owner", "manage", "write", "read"]


class Book(Api):
    id: str
    name: str = Field(description="The book's `option \"title\"`, or its ID if it has none.")
    currency: str = Field(description="Its operating currency (the first `operating_currency` option), or USD.")
    owner_id: str | None
    role: Role | None = Field(
        description="The caller's: owner; or a member's, manage (who has access, the name), write (its "
        "contents) or read."
    )
    created_at: str
    updated_at: str


class Member(Api):
    user_id: str
    role: Role
    updated_at: str | None = Field(description="Its version; None for the owner, whose role doesn't change.")


class MemberIn(Strict):
    role: Literal["manage", "write", "read"]
    updated_at: str | None = Field(None, description="Changing a member's role: the version read.")


class BookIn(Strict):
    name: str = Field(min_length=1, description="Unique among the caller's books, ignoring case.")
    text: str | None = Field(
        None,
        description="Beancount text to start the book with, such as an export: copied in with new"
        " directive IDs, its title replaced by `name`. Text that doesn't parse creates nothing (422).",
    )


class BookPatch(Strict):
    name: str = Field(min_length=1)
    updated_at: Version


class Applied(Api):
    put: int
    deleted: int


class Problem(Api):
    message: str
    directive_id: str | None


class QueryResult(Api):
    columns: list[str]
    rows: list[list[Any]]


class Backup(Api):
    since: int
    cursor: int
    chunks: dict[str, str] = Field(description="Book ID to a Beancount chunk.")
    deleted_books: list[str] = Field(
        default_factory=list,
        description="Books deleted since the cursor. Their chunks hold every directive's tombstone.",
    )


# Funds (Funds A)

FundName = Annotated[str, StringConstraints(min_length=1, max_length=60)]


class FundHolding(Api):
    """What a fund (or Unallocated) holds of one commodity, and what that's worth."""

    amount: Amount
    value: Amount | None = Field(description="In the operating currency; None when it has no price.")
    price: Amount | None = Field(None, description="Per unit, in the operating currency; None for that currency.")
    price_date: datetime.date | None = None


class Fund(Api):
    """A fund: money set aside for something. What it holds is its lines, its moves, and what
    the accounts it's the default fund of give it."""

    name: str
    description: str | None = None
    target: Amount | None = Field(None, description="What it's working toward, shown as progress: nothing fills it.")
    created: datetime.date | None = Field(None, description="When it was made; None for one only used (an imported book).")
    archived: datetime.date | None = Field(None, description="When it was archived: out of the pickers, history kept.")
    holdings: list[FundHolding] = Field(description="What it holds, per commodity: the operating currency first.")
    value: Amount = Field(description="What it holds, in the operating currency (what has no price left out).")
    unpriced: list[str] = Field(default_factory=list, description="Commodities it holds with no price.")
    accounts: list[str] = Field(default_factory=list, description="The accounts it's the default fund of today.")
    entries: int = Field(description="How many transaction lines and moves it has: none, and it can be deleted.")
    updated_at: str | None = Field(None, description="Its directive's version; None for one only used.")


class Funds(Api):
    """Every fund, and what's left: Unallocated is net worth less every fund."""

    on: datetime.date
    currency: str = Field(description="The book's operating currency, what values are in.")
    net_worth: Amount = Field(description="Every asset and liability, valued (what has no price left out).")
    unallocated: Amount = Field(description="Net worth less every fund's value: what isn't in a fund.")
    unpriced: list[str] = Field(default_factory=list, description="Commodities held with no price, left out of net worth.")
    unallocated_holdings: list[FundHolding] = Field(
        default_factory=list,
        description="What Unallocated holds, per commodity: what the accounts hold that no fund does.",
    )
    funds: list[Fund] = Field(description="Active funds by name, then archived ones.")
    defaults: list[FundDefault] = Field(default_factory=list, description="Every account's default funds, by account and date.")


class FundIn(Strict):
    name: FundName
    description: str | None = Field(None, max_length=200)
    target: Amount | None = None


class FundPatch(Strict):
    """Change only the fields given; null clears one."""

    updated_at: Version
    description: str | None = Field(None, max_length=200)
    target: Amount | None = None


class FundRename(Strict):
    to: FundName
    updated_at: Version


class FundArchive(Strict):
    updated_at: Version
    date: datetime.date | None = Field(None, description="When; default today. What's left moves then.")
    to: str = Field("Unallocated", description="Where what's left goes: Unallocated, or an active fund.")


class FundVersion(Strict):
    updated_at: Version


class FundEntry(Api):
    """One change to a fund: a transaction's line, or a move."""

    id: str = Field(description="The transaction's or the move's ID.")
    kind: Literal["transaction", "move"]
    date: datetime.date
    flag: str | None = Field(None, description="A transaction's flag: `!` unconfirmed.")
    payee: str | None = None
    narration: str | None = None
    amount: Amount = Field(description="Signed: positive into the fund.")
    balance: Amount = Field(description="The fund's balance after it, in its commodity.")
    other: str | None = Field(None, description="A move's other side: where it came from, or went.")
    note: str | None = None
    updated_at: str


class FundHistory(Api):
    fund: Fund
    entries: list[FundEntry] = Field(description="Newest first.")


class FundMoveIn(Strict):
    date: datetime.date
    from_fund: FundName = Field(description="A fund, or Unallocated.")
    to_fund: FundName = Field(description="A fund, or Unallocated.")
    amount: Amount = Field(description="How much moves: positive.")
    note: str | None = Field(None, max_length=200)


class FundMove(Api):
    id: str
    date: datetime.date
    from_fund: str
    to_fund: str
    amount: Amount
    note: str | None = None
    updated_at: str


class FundMovesIn(Strict):
    """Several moves at once (a move with several amounts): all of them, or none."""

    moves: list[FundMoveIn] = Field(min_length=1)


class FundDefault(Api):
    """From `date`, what changes in `account` (and under it) with no line saying otherwise is
    `fund`'s (Funds B). `fund` None: the account has none of its own from then on."""

    id: str
    account: str
    fund: str | None
    date: datetime.date
    updated_at: str


class FundDefaultIn(Strict):
    account: str
    fund: str | None = Field(description="A fund, Unallocated, or null for none of its own.")
    date: datetime.date = Field(description="From when.")


class FundDefaultPatch(Strict):
    """Change only the fields given."""

    updated_at: Version
    fund: str | None = None
    date: datetime.date | None = None


class FundDefaultPreview(Strict):
    """A default fund to be made (no `id`) or changed (`id`), or one to be deleted (`delete`)."""

    id: str | None = None
    account: str
    fund: str | None = None
    date: datetime.date
    delete: bool = False


class FundChange(Api):
    fund: str
    amounts: list[Amount] = Field(description="What it gains (positive) or loses, per commodity.")
    value: Amount = Field(description="Those amounts at today's prices.")


class FundDefaultEffect(Api):
    """What a default fund would do: each fund's change, and why it can't be saved, if it can't."""

    changes: list[FundChange]
    problem: str | None = None


class ShortTake(Api):
    fund: str = Field(description="A fund, or Unallocated.")
    amount: Amount = Field(description="What the transaction takes from it.")
    holding: Amount = Field(description="What the fund holds of it now: below zero.")


class ShortTransaction(Api):
    """A transaction that takes a share a fund doesn't have (Funds B): it came in by itself, and
    waits for a fund to be named."""

    id: str
    date: datetime.date
    flag: str | None
    payee: str | None = None
    narration: str | None = None
    added: str = Field(description="When it was written (its created_at).")
    updated_at: str
    takes: list[ShortTake]


class FundMovePatch(Strict):
    """Change only the fields given."""

    updated_at: Version
    date: datetime.date | None = None
    from_fund: FundName | None = None
    to_fund: FundName | None = None
    amount: Amount | None = None
    note: str | None = Field(None, max_length=200)


Funds.model_rebuild()
