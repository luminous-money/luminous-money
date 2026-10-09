"""The API's JSON shapes. These become the OpenAPI schema, and from it the TypeScript client.

Numbers are decimal strings, never JSON numbers, so amounts can't pick up floating-point error
anywhere between a form field and the ledger. Metadata values carry their Beancount type (text,
boolean, number, date, amount), so reading a transaction, editing it and writing it back loses
nothing.

JSON field names are camelCase (`updatedAt`), from snake_case Python names.

Every edit carries the `updatedAt` it read: the version. If the stored version has moved on, the
edit is refused with 409 Conflict rather than overwriting someone else's change.
"""

from __future__ import annotations

import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

DecimalStr = Annotated[str, StringConstraints(pattern=r"^-?\d+(\.\d+)?$")]
Flag = Annotated[str, StringConstraints(min_length=1, max_length=1)]


class Api(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Strict(Api):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


Version = Annotated[
    str,
    Field(
        description="The `updatedAt` this edit was based on. If the stored one differs, the edit is "
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


class AccountIn(Strict):
    name: str = Field(description="The full name. Its parent must be a node account; the parent's root sets the type.")
    kind: AccountKind = "leaf"
    open: datetime.date | None = Field(
        None, description="Defaults to when the parent opened, else the earliest account under it, else the book's first entry."
    )


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
