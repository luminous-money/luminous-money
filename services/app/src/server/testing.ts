/** An in-memory stand-in for the ledger, for unit tests of the import logic. */
import type { Account, MoneyAccount, Transaction, TransactionIn } from "@fava-beans/ledger-client";

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

  addAccount(name: string, extra: Partial<MoneyAccount> = {}) {
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

  async moneyAccounts(): Promise<MoneyAccount[]> {
    return this.accountList
      .filter((a) => a.money)
      .map((a) => ({ balance: [], ...a, as_of: a.as_of ?? a.open! }));
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
}
