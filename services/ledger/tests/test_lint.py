"""Lint: every table is created through `migrations.create_table`, so every table gets its
`created_at`/`updated_at` columns. Checks the syntax tree, so comments and docstrings don't count."""

import ast
import pathlib
import re

SOURCE = pathlib.Path(__file__).resolve().parent.parent / "src"
CREATE_TABLE = re.compile(r"\bcreate\s+table\b", re.IGNORECASE)


def docstrings(tree: ast.AST) -> set[int]:
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                found.add(id(body[0].value))
    return found


def offenders(path: pathlib.Path) -> list[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    allowed = docstrings(tree)
    for node in ast.walk(tree):
        if path.name == "migrations.py" and isinstance(node, ast.FunctionDef) and node.name == "create_table":
            allowed |= {id(n) for n in ast.walk(node)}
    return [
        f"{path.relative_to(SOURCE)}:{node.lineno}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and CREATE_TABLE.search(node.value)
        and id(node) not in allowed
    ]


def test_tables_are_only_created_through_the_helper():
    found = [o for path in sorted(SOURCE.rglob("*.py")) for o in offenders(path)]

    assert not found, "create tables with migrations.create_table, not raw CREATE TABLE: " + ", ".join(found)


def test_the_lint_catches_a_raw_create_table(tmp_path):
    rogue = tmp_path / "rogue.py"
    rogue.write_text('"""Docs may say CREATE TABLE."""\nSQL = "create table x (id text)"\n')

    assert [o.split(":")[1] for o in offenders_in(rogue)] == ["2"]


def offenders_in(path: pathlib.Path) -> list[str]:
    global SOURCE
    saved, SOURCE = SOURCE, path.parent
    try:
        return offenders(path)
    finally:
        SOURCE = saved
