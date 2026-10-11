/**
 * Lint: every table in the TypeScript services is created through `createTable`, so every table
 * gets its `created_at`/`updated_at` columns. Checks the syntax tree, so comments don't count.
 * (The ledger's Python has the same check in services/ledger/tests/test_lint.py.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HELPER = join(ROOT, "packages/db/src/index.ts");
const CREATE_TABLE = /\bcreate\s+table\b/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (["node_modules", "dist", "test", "tests"].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

export function offenders(path: string, text = readFileSync(path, "utf8")): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node, inHelper: boolean) => {
    const helper = inHelper || (path === HELPER && ts.isFunctionDeclaration(node) && node.name?.text === "createTable");
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (literal && !helper && CREATE_TABLE.test(node.text)) {
      found.push(`${relative(ROOT, path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, (child) => visit(child, helper));
  };
  visit(file, false);
  return found;
}

it("creates tables only through createTable", () => {
  const roots = ["packages", "services"].flatMap((top) =>
    readdirSync(join(ROOT, top)).map((name) => join(ROOT, top, name, "src"))
  );
  const found = roots.filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory()).flatMap((dir) => sources(dir).flatMap((f) => offenders(f)));

  expect(found, "create tables with createTable from @fava-beans/db, not raw CREATE TABLE").toEqual([]);
});

it("catches a raw CREATE TABLE, but not one in a comment", () => {
  const rogue = '// docs may say CREATE TABLE\nconst sql = "create table x (id text)";\nconst t = `CREATE TABLE ${"y"} (id text)`;\n';

  expect(offenders(join(ROOT, "services/x/src/rogue.ts"), rogue).map((o) => o.split(":")[1])).toEqual(["2", "3"]);
});
