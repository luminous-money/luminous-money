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


class TransactionIn(Strict):
    date: datetime.date
    flag: Flag = Field("!", description="`!` is staged for review; `*` is confirmed.")
    payee: str | None = None
    narration: str = ""
    tags: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    meta: Meta = Field(default_factory=dict)
    postings: list[Posting] = Field(min_length=1)


class Transaction(TransactionIn):
    id: str
    created_at: str
    updated_at: str = Field(description="Changes on every write; send it back with edits.")


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
    tags: list[str] | None = None
    links: list[str] | None = None
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
    booking: str | None = Field(
        None, description="How sales pick lots (FIFO, LIFO, HIFO, STRICT for specific lots, NONE for average cost); "
        "None: the book's default."
    )
    revalue_every: int | None = Field(
        None, description="A revalued asset (a house, a car): how many days its value stays current."
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
    booking: Booking | None = Field(
        None, description="FIFO, LIFO, HIFO, STRICT (choose lots), NONE (average cost, booked by fava-beans); "
        "None: the book's default."
    )
    revalue_every: int | None = Field(None, ge=1, description="A revalued asset: days its value stays current; None: not one.")


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


class CompactTransaction(Api):
    """A transaction with only what categorizers use: who, when, and where the money went."""

    id: str
    date: datetime.date
    flag: str
    payee: str | None
    narration: str | None
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
    updated_at: str


class LedgerPage(Api):
    rows: list[LedgerRow] = Field(description="Newest first.")
    next_cursor: str | None = Field(description="Pass as `cursor` for the next (older) page; None at the end.")
    prev_cursor: str | None = Field(
        description="Pass as `after` for the page before (newer); None when this page starts at the newest."
    )


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


class Directive(Api):
    """Any directive, as its canonical Beancount text plus the columns derived from it."""

    id: str
    date: datetime.date
    kind: str
    flag: str | None
    text: str
    created_at: str
    updated_at: str = Field(description="Changes on every write; send it back with edits.")


class Book(Api):
    id: str
    name: str = Field(description="The book's `option \"title\"`, or its ID if it has none.")
    created_at: str
    updated_at: str


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
