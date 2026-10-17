/** An in-memory stand-in for the ledger, for unit tests of the import logic. */
import type {
  Account,
  AccountIn,
  AccountSummary,
  CompactTransaction,
  Holdings,
  PriceOut,
  TradeIn,
  Transaction,
  TransactionIn,
} from "@fava-beans/ledger-client";

import {
  LedgerError,
  type Book,
  type BudgetStatus,
  type LedgerPage,
  type LedgerPort,
  type PriceIn,
  type TransactionEdit,
  type TreeAccount,
} from "./ledger.js";

export class FakeLedger implements LedgerPort {
  books = new Map<string, Book>();
  accountList: (Account & { as_of?: string })[] = [];
  transactions: Transaction[] = [];
  created: string[] = [];
  private next = 1;

  addBook(id: string) {
    this.books.set(id, { id, name: id, currency: "USD", created_at: "", updated_at: "" });
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
    const created = {
      ...t,
      id: `t${this.next++}`,
      created_at: "",
      updated_at: "v1",
    } as Transaction;
    this.transactions.push(created);
    return created;
  }

  async book(book: string) {
    return this.books.get(book);
  }

  async listBooks() {
    return [...this.books.values()];
  }

  async createBook(name: string) {
    const id = `b${this.next++}`;
    this.books.set(id, { id, name, created_at: "", updated_at: "v1" });
    return this.books.get(id)!;
  }

  async deleteBook(book: string, updated_at: string) {
    const found = this.books.get(book);
    if (!found) throw new LedgerError(404, `not found: ${book}`);
    if (found.updated_at !== updated_at) throw new LedgerError(409, "stale");
    this.books.delete(book);
  }

  async accounts() {
    return this.accountList;
  }

  async summary(_book: string, accounts: string[]): Promise<AccountSummary[]> {
    return this.accountList
      .filter((a) => accounts.includes(a.name))
      .map((a) => ({ balance: [], ...a, as_of: a.as_of ?? null }));
  }

  async createAccount(_book: string, name: string, extra: Partial<AccountIn> = {}) {
    this.created.push(name);
    const opening = extra.opening_balance;
    this.addAccount(name, opening ? { as_of: opening.date } : {});
    if (opening)
      this.addTransaction({
        date: opening.date,
        flag: "*",
        payee: null,
        narration: "Opening balance",
        tags: [],
        links: [],
        meta: {},
        postings: [
          { account: name, units: { number: opening.amount, currency: opening.currency ?? "USD" } },
          ...(extra.opening_holdings ?? []).map((h) => ({
            account: name,
            units: { number: h.units, currency: h.commodity },
            cost: { number_total: h.cost ?? "0", currency: "USD" },
          })),
          { account: "Equity:Opening-Balances", units: null },
        ],
      } as TransactionIn);
    return this.accountList.at(-1)!;
  }

  async renameAccount(_book: string, account: string, to: string) {
    const found = this.accountList.find((a) => a.name === account)!;
    found.name = to;
    return found;
  }

  async archiveAccount(_book: string, account: string) {
    return [account];
  }

  async unarchiveAccount(_book: string, account: string) {
    return [account];
  }

  async deleteAccount(_book: string, account: string) {
    this.accountList = this.accountList.filter((a) => a.name !== account);
    return [account];
  }

  prices: PriceIn[] = [];
  async addPrice(_book: string, price: PriceIn) {
    this.prices.push(price);
    return { ...price, id: `p${this.prices.length}`, source: null } as never;
  }

  /** Units (and total cost) per commodity in the account or under it, unconfirmed included. */
  async holdings(_book: string, account: string): Promise<Holdings> {
    const totals = new Map<string, { units: number; cost: number }>();
    for (const t of this.transactions)
      for (const p of t.postings) {
        const under = p.account === account || p.account.startsWith(`${account}:`);
        if (!under || !p.units || p.units.currency === "USD") continue;
        const entry = totals.get(p.units.currency) ?? { units: 0, cost: 0 };
        entry.units += Number(p.units.number);
        const cost = p.cost as { number_total?: string; number_per?: string } | null | undefined;
        entry.cost += Number(
          cost?.number_total ?? Number(cost?.number_per ?? 0) * Number(p.units.number)
        );
        totals.set(p.units.currency, entry);
      }
    return {
      account,
      currency: "USD",
      holdings: [...totals].map(([commodity, h]) => ({
        commodity,
        units: String(h.units),
        cost: { number: h.cost.toFixed(2), currency: "USD" },
        lots: [],
        price: null,
        price_date: null,
        value: null,
        gain: null,
        stale: false,
      })),
    } as unknown as Holdings;
  }

  /** A trade's transaction, booked naively: the holding at the price, the cash the other way. */
  async previewTrade(_book: string, account: string, trade: TradeIn) {
    const holding = trade.holding_account ?? `${account}:${trade.commodity}`;
    const units = Number(trade.units) * (trade.kind === "sell" ? -1 : 1);
    const cash = (-units * Number(trade.price)).toFixed(2);
    return {
      lots: [],
      opens: this.accountList.some((a) => a.name === holding) ? [] : [holding],
      transaction: {
        date: trade.date,
        flag: "*",
        payee: null,
        narration: trade.narration ?? "",
        tags: [],
        links: [],
        meta: {},
        postings: [
          {
            account: holding,
            units: { number: String(units), currency: trade.commodity },
            cost: { number_per: trade.price!, currency: "USD" },
          },
          {
            account: trade.cash_account ?? `${account}:Cash`,
            units: { number: cash, currency: "USD" },
          },
        ],
      } as TransactionIn,
    };
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
          counterpart:
            t.postings.length === 2 ? t.postings.find((p) => p.account !== account)!.account : null,
          splits: t.postings.length,
          updated_at: t.updated_at,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    return { rows, next_cursor: null, prev_cursor: null };
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
        budgeted: t.meta?.budget !== false,
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

  fetched = 0;
  async fetchPrices() {
    this.fetched++;
    return { fetched: [], errors: {} };
  }

  /** Each account's own balance (from the transactions) as its total, without rolling up. */
  async accountTree(): Promise<TreeAccount[]> {
    return this.accountList.map((a) => {
      const sums = new Map<string, number>();
      for (const t of this.transactions)
        for (const p of t.postings)
          if (p.units && (p.account === a.name || p.account.startsWith(`${a.name}:`)))
            sums.set(p.units.currency, (sums.get(p.units.currency) ?? 0) + Number(p.units.number));
      const total = [...sums].map(([currency, n]) => ({ number: n.toFixed(2), currency }));
      return {
        ...a,
        balance: [],
        total,
        value: { number: "0.00", currency: "USD" },
        unpriced: [],
        splits: 0,
        protected: false,
      } as TreeAccount;
    });
  }

  /** Price histories by commodity, as tests set them. */
  priceHistories: Record<string, PriceOut[]> = {};

  async priceHistory(_book: string, commodity: string): Promise<PriceOut[]> {
    return this.priceHistories[commodity] ?? [];
  }

  /** Budgets as set by tests (`status`), measured nowhere: what the ledger would answer. */
  budgets: BudgetStatus | null = null;

  async budgetStatus(_book: string, on: string, basis: "period" | "month"): Promise<BudgetStatus> {
    return this.budgets ?? { on, basis, lines: [], summary: null };
  }

  async unconfirmed() {
    return this.transactions.filter((t) => t.flag === "!");
  }

  async applyChanges(
    _book: string,
    changes: {
      create: TransactionIn[];
      update?: TransactionEdit[];
      delete: { id: string; updated_at: string }[];
    }
  ) {
    for (const d of [...(changes.update ?? []), ...changes.delete]) {
      const found = await this.transaction(_book, d.id); // must exist
      if (found.updated_at !== d.updated_at) throw new LedgerError(409, "stale");
    }
    for (const { id, updated_at: _v, ...patch } of changes.update ?? []) {
      const found = await this.transaction(_book, id);
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      Object.assign(found, defined, { updated_at: `v${this.next++}` });
    }
    const gone = new Set(changes.delete.map((d) => d.id));
    this.transactions = this.transactions.filter((t) => !gone.has(t.id));
    return changes.create.map((t) => this.addTransaction(t));
  }
}
