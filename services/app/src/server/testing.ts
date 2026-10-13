/** An in-memory stand-in for the ledger, for unit tests of the import logic. */
import type {
  Account,
  AccountSummary,
  CompactTransaction,
  Transaction,
  TransactionIn,
} from "@fava-beans/ledger-client";

import type { Book, LedgerPage, LedgerPort } from "./ledger.js";

export class FakeLedger implements LedgerPort {
  books = new Map<string, Book>();
  accountList: (Account & { as_of?: string })[] = [];
  transactions: Transaction[] = [];
  created: string[] = [];
  private next = 1;

  addBook(id: string) {
    this.books.set(id, { id, name: id, created_at: "", updated_at: "" });
  }

  addAccount(name: string, extra: Partial<Account> & { as_of?: string } = {}) {
    this.accountList.push({
      name,
      type: "asset",
      kind: "leaf",
      implicit: false,
      currencies: [],
      ...extra,
    } as Account);
  }

  addTransaction(t: TransactionIn): Transaction {
    const created = { ...t, id: `t${this.next++}`, created_at: "", updated_at: "" } as Transaction;
    this.transactions.push(created);
    return created;
  }

  async book(book: string) {
    return this.books.get(book);
  }

  async accounts() {
    return this.accountList;
  }

  async summary(_book: string, accounts: string[]): Promise<AccountSummary[]> {
    return this.accountList
      .filter((a) => accounts.includes(a.name))
      .map((a) => ({ balance: [], ...a, as_of: a.as_of ?? null }));
  }

  async createAccount(_book: string, name: string) {
    this.created.push(name);
    this.addAccount(name);
    return this.accountList.at(-1)!;
  }

  async accountLedger(_book: string, account: string): Promise<LedgerPage> {
    const rows = this.transactions
      .filter((t) => t.postings.some((p) => p.account === account))
      .map((t) => {
        const units = t.postings.find((p) => p.account === account)!.units ?? null;
        return {
          id: t.id,
          date: t.date,
          flag: t.flag,
          payee: t.payee ?? null,
          narration: t.narration ?? null,
          amount: units,
          balance: null,
          counterpart: null,
          splits: t.postings.length,
          updated_at: t.updated_at,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    return { rows, next_cursor: null };
  }

  async createTransactions(_book: string, transactions: TransactionIn[]) {
    return transactions.map((t) => this.addTransaction(t));
  }

  async transaction(_book: string, id: string) {
    const found = this.transactions.find((t) => t.id === id);
    if (!found) throw new Error(`no transaction ${id}`);
    return found;
  }

  async compact(_book: string, from: string): Promise<CompactTransaction[]> {
    return this.transactions
      .filter((t) => t.date >= from)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        id: t.id,
        date: t.date,
        flag: t.flag,
        payee: t.payee ?? null,
        narration: t.narration ?? null,
        postings: t.postings.map((p) => ({ account: p.account, amount: p.units ?? null })),
      }));
  }

  async patch(
    book: string,
    id: string,
    changes: Partial<Pick<TransactionIn, "postings" | "payee" | "flag">>,
    _updated_at: string
  ) {
    const found = await this.transaction(book, id);
    Object.assign(found, changes);
    return found;
  }

  async pending() {
    return this.transactions.filter((t) => t.flag === "!");
  }

  async applyChanges(
    _book: string,
    changes: { create: TransactionIn[]; delete: { id: string; updated_at: string }[] }
  ) {
    for (const d of changes.delete) await this.transaction(_book, d.id); // must exist
    const gone = new Set(changes.delete.map((d) => d.id));
    this.transactions = this.transactions.filter((t) => !gone.has(t.id));
    return changes.create.map((t) => this.addTransaction(t));
  }
}
