"""The Beancount adapter: every use of Beancount in this service goes through this module.

The rest of the service deals in directive *text* plus a few plain values extracted from it. A
directive's canonical text is what Beancount's printer produces for the parsed but unbooked entry,
with the directive's ID as its first metadata line, which makes it exactly the export format.

Only public Beancount API is used: the parser, the printer, and `loader.load_string`, which runs
the full pipeline (booking, plugins, validation). A Beancount upgrade has one place to break.
"""

from __future__ import annotations

import collections
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
KIND_KEY = "kind"
# An account's human name, since account names can't have spaces. Optional: the app falls back
# to the name's last segment.
DISPLAY_NAME_KEY = "display-name"
# A revalued asset (a house, a car): how many days its value stays current (M5).
REVALUE_EVERY_KEY = "revalue-every"
NODE = "node"
ROOT_OPTIONS = (
    ("name_assets", "asset"),
    ("name_liabilities", "liability"),
    ("name_equity", "equity"),
    ("name_income", "income"),
    ("name_expenses", "expense"),
)

NodePostingError = collections.namedtuple("NodePostingError", "source message entry")
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
    # The posting's change to its account in units, with an elided amount filled in when that's
    # unambiguous (see `_amounts`). None when only full booking could say.
    amount: Decimal | None = None
    amount_currency: str | None = None


@dataclass(frozen=True)
class Directive:
    id: str
    date: datetime.date
    kind: str  # "transaction", "open", "price", ...
    flag: str | None  # transactions only
    text: str
    postings: tuple[Posting, ...] = ()
    payee: str | None = None  # transactions only
    narration: str | None = None  # transactions only
    price: tuple[str, Decimal, str] | None = None  # price directives only: commodity, number, currency


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
        amounts = _amounts(entry)
        postings = tuple(
            Posting(
                account=p.account,
                number=None if p.units is MISSING or p.units.number is MISSING else p.units.number,
                currency=None if p.units is MISSING or p.units.currency is MISSING else p.units.currency,
                amount=amount[0] if amount else None,
                amount_currency=amount[1] if amount else None,
            )
            for p, amount in zip(entry.postings, amounts)
        )
    return Directive(
        id=str(directive_id),
        date=entry.date,
        kind=type(entry).__name__.lower(),
        flag=getattr(entry, "flag", None),
        text=printer.format_entry(entry).rstrip("\n") + "\n",
        postings=postings,
        payee=getattr(entry, "payee", None),
        narration=getattr(entry, "narration", None),
        price=(entry.currency, entry.amount.number, entry.amount.currency) if isinstance(entry, data.Price) else None,
    )


def _weight(p: data.Posting) -> tuple[Decimal, str] | None:
    """What a posting with an explicit amount contributes to balancing, as booking would weigh
    it: its units, or for a lot at a known cost its units times the cost (`{{total}}`: the
    total), or with a price its units times the price. None when only booking could say (a
    reduction like `{}` that leaves the lot to booking)."""
    units = p.units
    cost = p.cost
    if cost is not None:
        per = getattr(cost, "number_per", getattr(cost, "number", MISSING))
        total = getattr(cost, "number_total", None)
        currency = cost.currency
        if currency is MISSING or currency is None:
            return None
        if total not in (None, MISSING):
            return ((total + (units.number * per if per not in (None, MISSING) else 0)) * (1 if units.number > 0 else -1), currency)
        if per in (None, MISSING):
            return None
        return (units.number * per, currency)
    if p.price is not None and p.price is not MISSING:
        if p.price.number is MISSING or p.price.currency is MISSING:
            return None
        return (units.number * p.price.number, p.price.currency)
    return (units.number, units.currency)


def _amounts(entry: data.Transaction) -> list[tuple[Decimal, str] | None]:
    """Each posting's change to its account, in units, without full booking.

    Explicit amounts are themselves. A single elided amount is filled in, as booking would, when
    that's unambiguous: the other postings' weights (units, or for lots and prices their cost or
    price) are all in one currency, so the elided one is minus their sum. Anything else (several
    elided amounts, mixed currencies, a reduction whose lot only booking can pick) is left to
    booking: None.
    """
    explicit = [
        None if p.units is MISSING or p.units.number is MISSING or p.units.currency is MISSING else (p.units.number, p.units.currency)
        for p in entry.postings
    ]
    elided = [i for i, amount in enumerate(explicit) if amount is None]
    if len(elided) != 1:
        return explicit
    weights = [_weight(p) for i, p in enumerate(entry.postings) if i != elided[0]]
    currencies = {w[1] for w in weights if w}
    if all(weights) and len(currencies) == 1:
        explicit[elided[0]] = (-sum((w[0] for w in weights), Decimal(0)), currencies.pop())
    return explicit


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


def transactions(texts: list[str]) -> list[tuple[str, models.TransactionIn]]:
    """Structured views of stored transactions as (id, transaction), in the given order.
    Non-transactions are skipped."""
    entries, errors, _ = parser.parse_string("\n".join(texts))
    if errors:
        raise ParseFailure([_message(e) for e in errors])
    return [(str(e.meta[ID_KEY]), _transaction_model(e)) for e in entries if isinstance(e, data.Transaction)]


def accounts(header: list[str], texts: list[str]) -> list[models.Account]:
    """The chart of accounts, sorted by name.

    - Opened accounts come from `open` and `close` directives. An `open` with `kind: "node"`
      metadata is a node (holds sub-accounts); any other is a leaf (holds transactions).
    - The five top-level accounts always exist as nodes. Beancount can't open them, and every
      book has them.
    - A parent that was never opened but has accounts under it is an implicit node. Beancount
      won't accept postings to it either.
    """
    types = root_types(header)
    entries, errors, _ = parser.parse_string("\n".join(texts))
    if errors:
        raise ParseFailure([_message(e) for e in errors])

    def type_of(name: str):
        return types.get(name.split(":")[0])

    found: dict[str, models.Account] = {}
    for entry in entries:
        if isinstance(entry, data.Open):
            found[entry.account] = models.Account(
                name=entry.account,
                type=type_of(entry.account),
                kind="node" if entry.meta.get(KIND_KEY) == NODE else "leaf",
                open=entry.date,
                currencies=list(entry.currencies or []),
                display_name=entry.meta.get(DISPLAY_NAME_KEY),
                booking=entry.booking.name if entry.booking else None,
                revalue_every=int(entry.meta[REVALUE_EVERY_KEY]) if REVALUE_EVERY_KEY in entry.meta else None,
            )
    for entry in entries:
        if isinstance(entry, data.Close) and entry.account in found:
            found[entry.account].close = entry.date

    parents = {":".join(name.split(":")[:i]) for name in found for i in range(1, name.count(":") + 1)}
    for name in [*types, *parents]:
        if name not in found:
            found[name] = models.Account(name=name, type=type_of(name), kind="node", implicit=True)
    return sorted(found.values(), key=lambda a: a.name)


def segment(text: str) -> str:
    """Turn a human name into one valid account-name segment: "PNC checking" becomes
    "PNC-checking". Letters, digits and dashes only, starting with a capital or digit."""
    words = [re.sub(r"[^\w-]|_", "", word) for word in text.split()]
    part = "-".join(w for w in words if w)
    if not part:
        raise ParseFailure([f"can't make an account name from {text!r}"])
    return part[0].upper() + part[1:]


def decimal_text(number: Decimal) -> str:
    return format(number, "f")


def book_title(header: list[str]) -> str | None:
    """The book's name: its `option "title"`, if it has one."""
    for line in header:
        if line.startswith('option "title"'):
            _, _, options = parser.parse_string(line)
            return options["title"]
    return None


def with_title(header: list[str], title: str) -> list[str]:
    """The header with its title set to `title`, replacing any existing one."""
    escaped = title.replace("\\", "\\\\").replace('"', '\\"')
    line = f'option "title" "{escaped}"'
    _, errors, options = parser.parse_string(line)
    if errors or options["title"] != title:
        raise ParseFailure([f"can't use {title!r} as a book name"])
    return [line, *(existing for existing in header if not existing.startswith('option "title"'))]


def root_types(header: list[str]) -> dict[str, str]:
    """Top-level account names (renamable with options) and the type each stands for."""
    _, _, options = parser.parse_string("\n".join(header))
    return {options[key]: type_ for key, type_ in ROOT_OPTIONS}


def open_directive(
    name: str,
    date: datetime.date,
    kind: str,
    *,
    currencies: list[str] | None = None,
    meta: dict[str, str] | None = None,
) -> Directive:
    """An `open` directive. Built as an entry and printed, so metadata values are quoted and
    escaped properly; parsed again to validate the name."""
    entry_meta = {**({KIND_KEY: NODE} if kind == NODE else {}), **(meta or {})}
    entry = data.Open(data.new_metadata("<new>", 0, entry_meta), date, name, currencies or None, None)
    return parse_one(to_directive(entry).text)


def node_posting_message(account: str) -> str:
    return f"{account} is a node account and can't hold transactions; post to one of its sub-accounts"


def _validate_node_postings(entries: list[data.Directive], _options: dict) -> list[NodePostingError]:
    """Imported data can post to a node account; flag it like any other ledger problem."""
    nodes = {e.account for e in entries if isinstance(e, data.Open) and e.meta.get(KIND_KEY) == NODE}
    return [
        NodePostingError(entry.meta, node_posting_message(p.account), entry)
        for entry in entries
        if isinstance(entry, data.Transaction)
        for p in entry.postings
        if p.account in nodes
    ]


def _transaction_model(entry: data.Transaction) -> models.TransactionIn:
    return models.TransactionIn(
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


def moved_opens(open_texts: list[str], earliest: dict[str, datetime.date]) -> list[Directive]:
    """The `open` directives among `open_texts` dated after `earliest[account]`, moved back to it."""
    entries, errors, _ = parser.parse_string("\n".join(open_texts))
    if errors:
        raise ParseFailure([_message(e) for e in errors])
    return [
        to_directive(e._replace(date=earliest[e.account]))
        for e in entries
        if isinstance(e, data.Open) and e.account in earliest and e.date > earliest[e.account]
    ]


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
    # Run here rather than through `extra_validations`: Beancount 3.2 appends those to its global
    # list of validations on every load, so they'd run once more each time.
    errors = [*errors, *_validate_node_postings(entries, options)]
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
