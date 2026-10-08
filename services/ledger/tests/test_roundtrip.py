"""The core claim: a ledger stored as database rows books and validates exactly like the original."""

from beancount import loader
from conftest import FEATURES, canonical

from ledger import engine


def assert_round_trips(ledger, path):
    expected, expected_errors, _ = loader.load_file(path)
    ledger.apply_file("book", path)

    actual, actual_errors, _ = loader.load_string(ledger.export("book"))

    assert [e.message for e in actual_errors] == [e.message for e in expected_errors]
    assert canonical(actual) == canonical(expected)


def test_feature_fixture_round_trips(ledger):
    assert_round_trips(ledger, FEATURES)


def test_generated_example_round_trips(ledger, example_ledger):
    assert_round_trips(ledger, example_ledger)


def test_loading_from_rows_matches_loading_the_file(ledger):
    """The service's own engine path, not just the export, sees the same booked ledger."""
    expected, _, _ = loader.load_file(FEATURES)
    ledger.apply_file("book", FEATURES)

    loaded = ledger.load("book")

    assert loaded.problems == []
    assert canonical(loaded.entries) == canonical(expected)


def test_every_directive_gets_a_stable_id_in_the_export(ledger):
    ledger.apply_file("book", FEATURES)
    first = ledger.export("book")

    ledger.apply_text("book", first)

    assert ledger.export("book") == first
    parsed = engine.parse_text(first)
    assert len({d.id for d in parsed.directives}) == len(parsed.directives)


def test_header_keeps_options_and_plugins_from_included_files(ledger):
    ledger.apply_file("book", FEATURES)

    header = ledger.store.header("book")

    assert 'option "booking_method" "FIFO"' in header
    assert 'plugin "beancount.plugins.implicit_prices"' in header
    assert not any(line.startswith("include") for line in header)
