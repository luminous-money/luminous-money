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
} from "@luminous-money/ledger-client";

import { add, isZero, negate } from "../shared/decimal.js";
import { hasTags } from "../shared/tags.js";
import {
  LedgerError,
  type Attachment,
  type Book,
  type BudgetStatus,
  type DayBalances,
  type ReconcileIn,
  type ReconcileState,
  type Reconciled,
  type Reconciliations,
  type LedgerPage,
  type Member,
  type LedgerPort,
  type PriceIn,
  type TransactionEdit,
  type TreeAccount,
} from "./ledger.js";

/** As the ledger does: a confirmed transaction's splits lose their flags (M16). */
function confirmed<T extends Pick<TransactionIn, "flag" | "postings">>(t: T): T {
  if (t.flag === "*") t.postings = t.postings.map(({ flag: _f, ...p }) => p);
  return t;
}

export class FakeLedger implements LedgerPort {
  books = new Map<string, Book>();
  accountList: (Account & { as_of?: string })[] = [];
  transactions: Transaction[] = [];
  created: string[] = [];
  private next = 1;

  addBook(id: string) {
    this.books.set(id, {
      id,
      name: id,
      currency: "USD",
      owner_id: "u",
      role: "owner",
      created_at: "",
      updated_at: "",
    });
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
    const created = confirmed({
      ...t,
      id: `t${this.next++}`,
      created_at: "",
      updated_at: "v1",
    } as Transaction);
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

  async createAccounts(book: string, accounts: AccountIn[]) {
    const types: Record<string, Account["type"]> = {
      Assets: "asset",
      Liabilities: "liability",
      Equity: "equity",
      Income: "income",
      Expenses: "expense",
    };
    const names = new Set(this.accountList.map((a) => a.name));
    const taken = accounts.find((a) => names.has(a.name));
    if (taken) throw new Error(`${taken.name} already exists`);
    for (const a of accounts) {
      const { name, kind, display_name, description, opening_balance, ...rest } = a;
      await this.createAccount(book, name, { opening_balance, ...rest });
      Object.assign(this.accountList.at(-1)!, {
        kind,
        type: types[name.split(":")[0]!] ?? null,
        display_name: display_name ?? null,
        description: description ?? null,
      });
    }
    return accounts.map((a) => this.accountList.find((x) => x.name === a.name)!);
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

  /** The transactions posting to `account` or under it. */
  private touching(account: string) {
    const under = (name: string) => name === account || name.startsWith(`${account}:`);
    return this.transactions.filter((t) => t.postings.some((p) => under(p.account)));
  }

  async purgePreview(_book: string, account: string) {
    const doomed = this.touching(account);
    return {
      accounts: this.accountList
        .filter((a) => a.name === account || a.name.startsWith(`${account}:`))
        .map((a) => a.name),
      transactions: doomed.length,
      affected: [],
    };
  }

  async purgeAccount(book: string, account: string) {
    const { accounts } = await this.purgePreview(book, account);
    const doomed = new Set(this.touching(account).map((t) => t.id));
    this.transactions = this.transactions.filter((t) => !doomed.has(t.id));
    this.accountList = this.accountList.filter((a) => !accounts.includes(a.name));
    return { accounts, transactions: [...doomed] };
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
    // An account and everything under it, as the ledger has it (a divided account's parts too).
    const mine = (name: string) => name === account || name.startsWith(`${account}:`);
    const node = this.accountList.some((a) => a.name.startsWith(`${account}:`));
    const rows = this.transactions
      .filter((t) => t.postings.some((p) => mine(p.account)))
      .map((t) => {
        const ours = t.postings.filter((p) => mine(p.account));
        const others = t.postings.filter((p) => !mine(p.account));
        const amount = ours.every((p) => p.units)
          ? {
              number: ours.reduce((n, p) => add(n, p.units!.number), "0"),
              currency: ours[0]!.units!.currency,
            }
          : null;
        return {
          id: t.id,
          date: t.date,
          flag: t.flag,
          payee: t.payee ?? null,
          narration: t.narration ?? null,
          amount: ours.length === 1 ? (ours[0]!.units ?? null) : amount,
          balance: null,
          counterpart: t.postings.length === 2 && others.length === 1 ? others[0]!.account : null,
          splits: t.postings.length,
          parts: node ? ours.map((p) => ({ account: p.account, amount: p.units ?? null })) : [],
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

  async compact(_book: string, from?: string, tags: string[] = []): Promise<CompactTransaction[]> {
    return this.transactions
      .filter((t) => (!from || t.date >= from) && hasTags(t.tags, tags))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        id: t.id,
        date: t.date,
        flag: t.flag,
        payee: t.payee ?? null,
        narration: t.narration ?? null,
        budgeted: t.meta?.budget !== false,
        tags: [...(t.tags ?? [])].sort(),
        postings: t.postings.map((p) => ({
          account: p.account,
          amount: p.units ?? null,
          flag: p.flag ?? null,
          memo: typeof p.meta?.["memo"] === "string" ? (p.meta["memo"] as string) : null,
        })),
      }));
  }

  async patch(
    book: string,
    id: string,
    changes: Partial<Pick<TransactionIn, "postings" | "payee" | "narration" | "flag" | "meta">>,
    _updated_at: string
  ) {
    const found = await this.transaction(book, id);
    Object.assign(found, changes);
    return confirmed(found);
  }

  fetched = 0;
  async fetchPrices() {
    this.fetched++;
    return { fetched: [], errors: {} };
  }

  /** The book's members besides its owner ("u"), by user. */
  memberRoles = new Map<string, Member>();

  async members(): Promise<Member[]> {
    return [{ user_id: "u", role: "owner", updated_at: null }, ...this.memberRoles.values()];
  }

  async putMember(_book: string, user: string, member: { role: "read" | "write" | "manage" }) {
    const made = { user_id: user, role: member.role, updated_at: `m${this.next++}` };
    this.memberRoles.set(user, made);
    return made;
  }

  async removeMember(_book: string, user: string) {
    if (!this.memberRoles.delete(user)) throw new LedgerError(404, "not found");
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

  // Reconciliation, for a leaf in USD: marks on postings, a statement per account.
  statements = new Map<string, { date: string; balance: string }[]>();
  private posting(t: Transaction, account: string) {
    return t.postings.find((p) => p.account === account);
  }
  private sum(account: string, keep: (t: Transaction) => boolean) {
    return this.transactions
      .filter((t) => keep(t) && this.posting(t, account)?.units)
      .reduce((total, t) => add(total, this.posting(t, account)!.units!.number), "0");
  }

  attachments: { transaction: string; name: string; type: string; size: number }[] = [];
  /** The attached files, by attachment ID. */
  files = new Map<string, { name: string; type: string; bytes: Uint8Array }>();
  async attach(
    _book: string,
    transaction: string,
    file: { name: string; type: string; bytes: Uint8Array }
  ) {
    this.attachments.push({
      transaction,
      name: file.name,
      type: file.type,
      size: file.bytes.length,
    });
    const id = `a${this.attachments.length}`;
    this.files.set(id, file);
    return {
      id,
      transaction_id: transaction,
      filename: file.name,
      content_type: file.type,
      size: file.bytes.length,
      sha256: "",
      created_at: "2026-01-01T00:00:00Z",
    } satisfies Attachment;
  }

  async attachmentFile(_book: string, attachment: string) {
    const found = this.files.get(attachment);
    if (!found) throw new LedgerError(404, "no such attachment");
    return found;
  }

  /** Divide a leaf (M15), as the ledger does: its postings to the main part, the parts given
   * their amounts by one transfer. */
  async divide(
    book: string,
    account: string,
    d: { main?: string; parts?: { name: string; amount: string }[]; date: string }
  ) {
    const found = this.accountList.find((a) => a.name === account);
    if (!found || found.kind !== "leaf") throw new LedgerError(422, "not a leaf");
    const main = `${account}:${d.main ?? "General"}`;
    for (const t of this.transactions)
      for (const p of t.postings) if (p.account === account) p.account = main;
    Object.assign(found, { kind: "node", divided: true, main_part: main, currencies: [] });
    this.addAccount(main, { currencies: ["USD"], as_of: found.as_of });
    for (const part of d.parts ?? [])
      this.addAccount(`${account}:${part.name}`, { currencies: ["USD"] });
    const moving = (d.parts ?? []).filter((p) => !isZero(p.amount));
    if (moving.length)
      this.addTransaction({
        date: d.date,
        flag: "*",
        payee: null,
        narration: "Divided",
        tags: [],
        links: [],
        meta: {},
        postings: [
          {
            account: main,
            units: {
              number: negate(moving.reduce((n, p) => add(n, p.amount), "0")),
              currency: "USD",
            },
          },
          ...moving.map((p) => ({
            account: `${account}:${p.name}`,
            units: { number: p.amount, currency: "USD" },
          })),
        ],
      } as TransactionIn);
    return found;
  }

  async setAccount(_book: string, account: string, patch: { divided?: boolean | null }) {
    const found = this.accountList.find((a) => a.name === account);
    if (!found) throw new LedgerError(404, "not found");
    if (patch.divided !== undefined) found.divided = !!patch.divided;
    return found;
  }

  async reconciliation(_book: string, account: string, through?: string): Promise<ReconcileState> {
    const until = through
      ? new Date(Date.parse(`${through}T00:00:00Z`) + 14 * 864e5).toISOString().slice(0, 10)
      : "9999-12-31";
    const open = this.transactions.filter((t) => {
      const p = this.posting(t, account);
      return p && !p.meta?.reconciled && t.date <= until;
    });
    return {
      account,
      currency: "USD",
      reconciled_balance: {
        number: this.sum(account, (t) => !!this.posting(t, account)?.meta?.reconciled),
        currency: "USD",
      },
      last: this.statements.get(account)?.at(-1)?.date ?? null,
      transactions: open
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => ({
          id: t.id,
          date: t.date,
          flag: t.flag,
          payee: t.payee ?? null,
          narration: t.narration ?? null,
          amount: this.posting(t, account)!.units ?? { number: "0", currency: "USD" },
          counterpart: t.postings.find((p) => p.account !== account)?.account ?? null,
          opening: t.postings.some((p) => p.account === "Equity:Opening-Balances"),
          updated_at: t.updated_at,
        })),
      internal: 0,
    };
  }

  async reconcile(book: string, account: string, r: ReconcileIn): Promise<Reconciled> {
    const state = await this.reconciliation(book, account, r.statement_date);
    const ticked = state.transactions.filter((t) => r.transactions.includes(t.id));
    const reached = ticked.reduce(
      (total, t) => add(total, t.amount.number),
      state.reconciled_balance.number
    );
    if (!isZero(add(reached, negate(r.balance)))) throw new LedgerError(422, "it doesn't balance");
    const confirmed: string[] = [];
    for (const item of ticked) {
      const t = await this.transaction(book, item.id);
      if (t.flag === "!") confirmed.push(t.id);
      t.flag = "*";
      const p = this.posting(t, account)!;
      p.meta = { ...p.meta, reconciled: { date: r.statement_date } };
      t.updated_at = `v${this.next++}`;
    }
    const list = this.statements.get(account) ?? [];
    list.push({ date: r.statement_date, balance: r.balance });
    this.statements.set(account, list);
    return {
      reconciliation: {
        id: `b${this.next++}`,
        account,
        statement_date: r.statement_date,
        balance: { number: r.balance, currency: "USD" },
        statement: true,
        transactions: ticked.length,
        off_by: null,
        updated_at: "v1",
      },
      confirmed,
    };
  }

  async reconciliations(_book: string, account: string): Promise<Reconciliations> {
    return {
      account,
      reconciliations: [...(this.statements.get(account) ?? [])].reverse().map((s, i) => ({
        id: `b${i}`,
        account,
        statement_date: s.date,
        balance: { number: s.balance, currency: "USD" },
        statement: true,
        transactions: 0,
        off_by: null,
        updated_at: "v1",
      })),
    };
  }

  async dayBalances(
    _book: string,
    account: string,
    from: string,
    to: string
  ): Promise<DayBalances> {
    const days = [
      ...new Set(
        this.transactions
          .filter((t) => this.posting(t, account) && t.date >= from && t.date <= to)
          .map((t) => t.date)
      ),
    ].sort();
    return {
      account,
      currency: "USD",
      before: this.sum(account, (t) => t.date < from),
      days: days.map((date) => ({ date, balance: this.sum(account, (t) => t.date <= date) })),
    };
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
