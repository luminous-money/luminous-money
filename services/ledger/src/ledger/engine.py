"""The Beancount adapter: every use of Beancount in this service goes through this module.

The rest of the service deals in directive *text* plus a few plain values extracted from it. A
directive's canonical text is what Beancount's printer produces for the parsed but unbooked entry,
with the directive's ID as its first metadata line, which makes it exactly the export format.

Only public Beancount API is used: the parser, the printer, and `loader.load_string`, which runs
the full pipeline (booking, plugins, validation). A Beancount upgrade has one place to break.
"""

from __future__ import annotations

import datetime
import glob
import os
import re
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import beanquery
from beancount import loader
from beancount.core import amount as bc_amount
from beancount.core import data
from beancount.core.inventory import Inventory
from beancount.core.number import MISSING
from beancount.core.position import Cost as BookedCost
from beancount.core.position import CostSpec
from beancount.parser import parser, printer

from . import models

ID_KEY = "id"
TOMBSTONE_TYPE = "fava-beans"
TOMBSTONE_VALUE = "deleted"

_HEADER_LINE = re.compile(r"^(?:option|plugin)\s.*$", re.MULTILINE)


class ParseFailure(Exception):
    """Input that can't be stored as-is. Storing it anyway would lose data."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass(frozen=True)
class Posting:
    account: str
    number: Decimal | None  # None when elided, to be filled in by booking
    currency: str | None


@dataclass(frozen=True)
class Directive:
    id: str
    date: datetime.date
    kind: str  # "transaction", "open", "price", ...
    flag: str | None  # transactions only
    text: str
    postings: tuple[Posting, ...] = ()


@dataclass(frozen=True)
class Parsed:
    header: list[str]
    directives: list[Directive]  # canonical order: date, then directive type, then input order
    tombstones: list[str]  # IDs deleted by `custom "fava-beans" "deleted" "<id>"`


@dataclass(frozen=True)
class Problem:
    message: str
    directive_id: str | None


@dataclass(frozen=True)
class Loaded:
    entries: list[data.Directive]
    options: dict[str, Any]
    problems: list[Problem] = field(default_factory=list)


def new_id() -> str:
    return uuid.uuid4().hex


def parse_text(text: str) -> Parsed:
    entries, errors, options = parser.parse_string(text)
    if options["include"]:
        errors = [*errors, "include is only supported when importing files; inline the included text"]
    return _parsed([(text, entries, errors)])


def parse_file(path: str) -> Parsed:
    """Parse a ledger file and everything it includes, without booking it."""
    return _parsed(_parse_recursive(os.path.abspath(path), seen=set()))


def _parse_recursive(path: str, seen: set[str]) -> list[tuple[str, list, list]]:
    if path in seen:
        return []
    seen.add(path)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    entries, errors, options = parser.parse_string(text, report_filename=path)
    results = [(text, entries, errors)]
    for pattern in options["include"]:
        full = pattern if os.path.isabs(pattern) else os.path.join(os.path.dirname(path), pattern)
        matches = sorted(glob.glob(full))
        if not matches:
            results.append(("", [], [f"{path}: include matched nothing: {pattern}"]))
        for match in matches:
            results.extend(_parse_recursive(os.path.abspath(match), seen))
    return results


def _parsed(sources: list[tuple[str, list, list]]) -> Parsed:
    messages = [e if isinstance(e, str) else _message(e) for _, _, errs in sources for e in errs]
    if messages:
        raise ParseFailure(messages)

    header = [line for text, _, _ in sources for line in _HEADER_LINE.findall(text)]
    positioned = [entry for _, entries, _ in sources for entry in entries]
    order = {id(entry): i for i, entry in enumerate(positioned)}
    positioned.sort(key=lambda e: (e.date, data.SORT_ORDER.get(type(e), 0), order[id(e)]))

    directives, tombstones = [], []
    for entry in positioned:
        if _is_tombstone(entry):
            tombstones.append(entry.values[1].value)
        else:
            directives.append(to_directive(entry))
    return Parsed(header=_dedupe(header), directives=directives, tombstones=tombstones)


def to_directive(entry: data.Directive, directive_id: str | None = None) -> Directive:
    """Canonicalize a parsed entry, keeping its `id` metadata or assigning a new one."""
    meta = {k: v for k, v in entry.meta.items() if k not in ("filename", "lineno", ID_KEY)}
    directive_id = directive_id or entry.meta.get(ID_KEY) or new_id()
    entry = entry._replace(meta={ID_KEY: str(directive_id), **meta})
    postings = ()
    if isinstance(entry, data.Transaction):
        postings = tuple(
            Posting(
                account=p.account,
                number=None if p.units is MISSING or p.units.number is MISSING else p.units.number,
                currency=None if p.units is MISSING or p.units.currency is MISSING else p.units.currency,
            )
            for p in entry.postings
        )
    return Directive(
        id=str(directive_id),
        date=entry.date,
        kind=type(entry).__name__.lower(),
        flag=getattr(entry, "flag", None),
        text=printer.format_entry(entry).rstrip("\n") + "\n",
        postings=postings,
    )


def parse_one(text: str, directive_id: str | None = None) -> Directive:
    """Parse text that must hold exactly one directive (the unit of a write).

    With `directive_id`, the directive takes that ID; an explicit, different `id` in the text is
    an error rather than being silently overwritten.
    """
    entries, errors, _ = parser.parse_string(text)
    if errors:
        raise ParseFailure([_message(e) for e in errors])
    if _HEADER_LINE.search(text) or len(entries) != 1 or _is_tombstone(entries[0]):
        raise ParseFailure(["expected exactly one directive, with no options or plugins"])
    given = entries[0].meta.get(ID_KEY)
    if directive_id is not None and given is not None and str(given) != directive_id:
        raise ParseFailure([f"directive id {given} does not match {directive_id}"])
    return to_directive(entries[0], directive_id)


def transaction_directive(t: models.TransactionIn, directive_id: str | None = None) -> Directive:
    """Render a structured transaction as a canonical directive.

    The printed text is parsed again before it's returned. That validates what Pydantic can't
    (account names, currencies, flags, metadata keys) and guarantees the stored text is exactly
    what parsing it would produce.
    """
    entry = data.Transaction(
        meta=_meta_in(t.meta),
        date=t.date,
        flag=t.flag,
        payee=t.payee,
        narration=t.narration,
        tags=frozenset(t.tags),
        links=frozenset(t.links),
        postings=[
            data.Posting(
                account=p.account,
                units=_amount_in(p.units) if p.units else MISSING,
                cost=_cost_in(p.cost),
                price=_amount_in(p.price) if p.price else None,
                flag=p.flag,
                meta=_meta_in(p.meta) or None,
            )
            for p in t.postings
        ],
    )
    directive = to_directive(entry, directive_id)
    return parse_one(directive.text, directive.id)


def transactions(texts: list[str]) -> list[models.Transaction]:
    """Structured views of stored transactions, in the given order. Non-transactions are skipped."""
    entries, errors, _ = parser.parse_string("\n".join(texts))
    if errors:
        raise ParseFailure([_message(e) for e in errors])
    return [_transaction_model(e) for e in entries if isinstance(e, data.Transaction)]


def accounts(texts: list[str]) -> list[models.Account]:
    """The chart of accounts declared by `open` and `close` directives, sorted by name."""
    entries, errors, _ = parser.parse_string("\n".join(texts))
    if errors:
        raise ParseFailure([_message(e) for e in errors])
    found: dict[str, models.Account] = {}
    for entry in entries:
        if isinstance(entry, data.Open):
            found[entry.account] = models.Account(
                name=entry.account, open=entry.date, currencies=list(entry.currencies or [])
            )
    for entry in entries:
        if isinstance(entry, data.Close) and entry.account in found:
            found[entry.account].close = entry.date
    return sorted(found.values(), key=lambda a: a.name)


def _transaction_model(entry: data.Transaction) -> models.Transaction:
    return models.Transaction(
        id=str(entry.meta[ID_KEY]),
        date=entry.date,
        flag=entry.flag,
        payee=entry.payee,
        narration=entry.narration or "",
        tags=sorted(entry.tags or ()),
        links=sorted(entry.links or ()),
        meta=_meta_out(entry.meta),
        postings=[
            models.Posting(
                account=p.account,
                units=_amount_out(p.units),
                cost=_cost_out(p.cost),
                price=_amount_out(p.price),
                flag=p.flag,
                meta=_meta_out(p.meta),
            )
            for p in entry.postings
        ],
    )


def _num(number: Decimal) -> str:
    return format(number, "f")


def _amount_in(a: models.Amount) -> bc_amount.Amount:
    return bc_amount.Amount(Decimal(a.number), a.currency)


def _amount_out(a: Any) -> models.Amount | None:
    """Incomplete amounts (an elided number or currency) have no JSON form and come back as None."""
    if a is None or a is MISSING or a.number is MISSING or a.currency is MISSING:
        return None
    return models.Amount(number=_num(a.number), currency=a.currency)


def _cost_in(c: models.Cost | None) -> CostSpec | None:
    if c is None:
        return None
    return CostSpec(
        number_per=MISSING if c.number is None else Decimal(c.number),
        number_total=None if c.total is None else Decimal(c.total),
        currency=c.currency or MISSING,
        date=c.date,
        label=c.label,
        merge=False,
    )


def _cost_out(c: Any) -> models.Cost | None:
    if c is None:
        return None
    if isinstance(c, BookedCost):
        number, total = c.number, None
    else:
        number, total = c.number_per, c.number_total
    return models.Cost(
        number=None if number in (None, MISSING) else _num(number),
        total=None if total in (None, MISSING) else _num(total),
        currency=None if c.currency is MISSING else c.currency,
        date=c.date,
        label=c.label,
    )


def _meta_in(meta: models.Meta) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in meta.items():
        if isinstance(value, models.MetaNumber):
            out[key] = Decimal(value.number)
        elif isinstance(value, models.MetaDate):
            out[key] = value.date
        elif isinstance(value, models.Amount):
            out[key] = _amount_in(value)
        else:
            out[key] = value
    return out


def _meta_out(meta: dict[str, Any] | None) -> models.Meta:
    out: models.Meta = {}
    for key, value in (meta or {}).items():
        if key in ("filename", "lineno", ID_KEY) or key.startswith("__"):
            continue
        if isinstance(value, (bool, str)):
            out[key] = value
        elif isinstance(value, Decimal):
            out[key] = models.MetaNumber(number=_num(value))
        elif isinstance(value, datetime.date):
            out[key] = models.MetaDate(date=value)
        elif isinstance(value, bc_amount.Amount) and (converted := _amount_out(value)):
            out[key] = converted
    return out


def with_flag(text: str, flag: str) -> Directive:
    entries, errors, _ = parser.parse_string(text)
    if errors or len(entries) != 1 or not isinstance(entries[0], data.Transaction):
        raise ParseFailure(["only transactions carry a flag"])
    return to_directive(entries[0]._replace(flag=flag))


def tombstone(directive_id: str, date: datetime.date) -> str:
    return f'{date.isoformat()} custom "{TOMBSTONE_TYPE}" "{TOMBSTONE_VALUE}" "{directive_id}"\n'


def render(header: list[str], texts: list[str]) -> str:
    """Assemble a complete Beancount ledger: the header, then the directives in the given order."""
    parts = ["\n".join(header) + "\n"] if header else []
    parts.extend(texts)
    return "\n".join(parts)


def load(header: list[str], texts: list[str]) -> Loaded:
    """Book, run plugins over, and validate a ledger. This is the full Beancount pipeline."""
    entries, errors, options = loader.load_string(render(header, texts))
    return Loaded(entries=entries, options=options, problems=[_problem(e) for e in errors])


def query(loaded: Loaded, bql: str) -> tuple[list[str], list[list[Any]]]:
    connection = beanquery.connect("beancount:", entries=loaded.entries, errors=[], options=loaded.options)
    cursor = connection.execute(bql)
    columns = [c.name for c in cursor.description]
    return columns, [[_plain(v) for v in row] for row in cursor.fetchall()]


def _plain(value: Any) -> Any:
    """Render query values as JSON-friendly values without losing precision (numbers become strings)."""
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, (Decimal, datetime.date)):
        return str(value)
    if isinstance(value, Inventory):
        return [str(position) for position in value]
    if isinstance(value, (set, frozenset, list, tuple)):
        return [_plain(v) for v in value]
    return str(value)


def _problem(error: data.BeancountError | Any) -> Problem:
    source = getattr(error, "source", None) or {}
    entry = getattr(error, "entry", None)
    directive_id = source.get(ID_KEY) or (entry.meta.get(ID_KEY) if entry is not None else None)
    return Problem(message=_message(error), directive_id=directive_id)


def _message(error: Any) -> str:
    source = getattr(error, "source", None) or {}
    where = f"{source.get('filename')}:{source.get('lineno')}: " if source.get("filename") else ""
    return f"{where}{getattr(error, 'message', error)}"


def _is_tombstone(entry: data.Directive) -> bool:
    return (
        isinstance(entry, data.Custom)
        and entry.type == TOMBSTONE_TYPE
        and len(entry.values) == 2
        and entry.values[0].value == TOMBSTONE_VALUE
    )


def _dedupe(lines: list[str]) -> list[str]:
    return list(dict.fromkeys(lines))
