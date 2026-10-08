"""The API's JSON shapes. These become the OpenAPI schema, and from it the TypeScript client.

Numbers are decimal strings, never JSON numbers, so amounts can't pick up floating-point error
anywhere between a form field and the ledger. Metadata values carry their Beancount type (text,
boolean, number, date, amount), so reading a transaction, editing it and writing it back loses
nothing.
"""

from __future__ import annotations

import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DecimalStr = Annotated[str, StringConstraints(pattern=r"^-?\d+(\.\d+)?$")]
Flag = Annotated[str, StringConstraints(min_length=1, max_length=1)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


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


class Directive(BaseModel):
    """Any directive, as its canonical Beancount text plus the columns derived from it."""

    id: str
    date: datetime.date
    kind: str
    flag: str | None
    text: str


class Book(BaseModel):
    id: str


class Applied(BaseModel):
    put: int
    deleted: int


class Problem(BaseModel):
    message: str
    directive_id: str | None


class QueryResult(BaseModel):
    columns: list[str]
    rows: list[list[Any]]


class Backup(BaseModel):
    since: int
    cursor: int
    chunks: dict[str, str] = Field(description="Book ID to a Beancount chunk.")
