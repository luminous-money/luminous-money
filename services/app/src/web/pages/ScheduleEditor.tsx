import type { Transaction } from "@fava-beans/ledger-client";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import {
  addDays,
  describe,
  due,
  nominalDates,
  problem,
  upcoming,
  type Rule,
  type Schedule,
  type TransactionTemplate,
  type Unit,
  type Weekend,
} from "../../shared/schedule.js";
import { SplitsFieldset, useSplits } from "../components/Splits.js";
import { postable } from "../lib/accounts.js";
import { today } from "../lib/format.js";
import { useBack, useParam } from "../lib/navigation.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useDeleteSchedule,
  useSaveSchedule,
  useSchedule,
  useTransaction,
} from "../lib/queries.js";

const BLANK: TransactionTemplate = {
  payee: null,
  narration: "",
  tags: [],
  links: [],
  meta: {},
  postings: [
    { account: "", units: null },
    { account: "", units: null },
  ],
};

const monthly = (start: string): Rule => ({
  every: 1,
  unit: "month",
  days: [],
  start,
  until: null,
  weekend: "keep",
});

/** A transaction as a template to repeat: monthly, from a month after its date. */
function fromTransaction(t: Transaction): {
  name: string;
  rule: Rule;
  template: TransactionTemplate;
} {
  const next = nominalDates(monthly(t.date), t.date, addDays(t.date, 62))[0] ?? t.date;
  const { id: _id, date: _date, flag: _flag, created_at: _c, updated_at: _u, ...rest } = t;
  return {
    name: t.payee || t.narration || "Repeating transaction",
    rule: monthly(next),
    template: {
      payee: rest.payee ?? null,
      narration: rest.narration,
      tags: rest.tags ?? [],
      links: rest.links ?? [],
      meta: rest.meta ?? {},
      postings: rest.postings as TransactionTemplate["postings"],
    },
  };
}

/** "1, 15, last" to [1, 15, -1]; null if it doesn't read. */
function parseDays(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const days = parts.map((p) => (/^last$/i.test(p) ? -1 : Number(p)));
  return days.every((d) => d === -1 || (Number.isInteger(d) && d >= 1 && d <= 31)) ? days : null;
}

const showDays = (days: number[]) => days.map((d) => (d === -1 ? "last" : String(d))).join(", ");

/** A new schedule (blank, or from `?from=<transaction>` for "Repeat…"), or an existing one. */
export function ScheduleEditor({ book, id }: { book: string; id?: string }) {
  const from = useParam("from");
  const existing = useSchedule(book, id);
  const source = useTransaction(book, from ?? "");
  const back = useBack(`/books/${book}/schedules`);
  const loading = (id && existing.isPending) || (from && source.isPending);

  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>{id ? "Edit schedule" : "New schedule"}</h1>
      </header>
      {loading && <p className="muted">Loading…</p>}
      {existing.error && <p className="card error">{explain(existing.error)}</p>}
      {!loading && (
        <Form
          key={existing.data?.updated_at ?? source.data?.id ?? "new"}
          book={book}
          schedule={existing.data}
          initial={
            existing.data ??
            (source.data
              ? fromTransaction(source.data)
              : { name: "", rule: monthly(today()), template: BLANK })
          }
          back={back}
        />
      )}
    </main>
  );
}

function Form({
  book,
  schedule,
  initial,
  back,
}: {
  book: string;
  schedule?: Schedule;
  initial: { name: string; rule: Rule; template: TransactionTemplate };
  back: string;
}) {
  const [, navigate] = useLocation();
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const save = useSaveSchedule(book);
  const remove = useDeleteSchedule(book);
  const [name, setName] = useState(initial.name);
  const [payee, setPayee] = useState(initial.template.payee ?? "");
  const [narration, setNarration] = useState(initial.template.narration);
  const [every, setEvery] = useState(String(initial.rule.every));
  const [unit, setUnit] = useState<Unit>(initial.rule.unit);
  const [days, setDays] = useState(showDays(initial.rule.days));
  const [start, setStart] = useState(initial.rule.start);
  const [until, setUntil] = useState(initial.rule.until ?? "");
  const [weekend, setWeekend] = useState<Weekend>(initial.rule.weekend);
  const [paused, setPaused] = useState(schedule?.paused ?? false);
  const [error, setError] = useState<string | null>(null);
  const postings = useMemo(
    () => initial.template.postings as Transaction["postings"],
    [initial.template.postings]
  );
  const currency = postings.find((p) => p.units)?.units?.currency ?? "USD";
  const splits = useSplits(postings, currency);
  const names = accounts.data ? postable(accounts.data, today()) : [];

  const parsedDays = unit === "month" ? parseDays(days) : [];
  const rule: Rule = {
    every: Number(every),
    unit,
    days: parsedDays ?? [],
    start,
    until: until || null,
    weekend,
  };
  const ruleProblem =
    parsedDays === null ? "Days of the month are 1 to 31, or last" : problem(rule);
  const preview = ruleProblem ? [] : upcoming(rule, today(), 4);
  // A new schedule starting in the past stages everything since its start right away.
  const backfill = !schedule && !ruleProblem ? due(rule, null, today()).length : 0;
  const valid =
    name.trim() !== "" &&
    !ruleProblem &&
    splits.balance.state !== "invalid" &&
    !splits.uncategorized &&
    splits.postings.every((p) => p.account);

  const submit = async () => {
    setError(null);
    const template: TransactionTemplate = {
      ...initial.template,
      payee: payee.trim() || null,
      narration,
      postings: splits.postings as TransactionTemplate["postings"],
    };
    try {
      await save.mutateAsync(
        schedule
          ? {
              id: schedule.id,
              schedule: { updated_at: schedule.updated_at, name, rule, template, paused },
            }
          : { schedule: { name, rule, template, paused } }
      );
      navigate(`/books/${book}/schedules`);
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <form className="editor" onSubmit={(e) => (e.preventDefault(), valid && void submit())}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent" />
      </label>

      <fieldset className="rule">
        <legend>Repeats</legend>
        <div className="row-fields">
          <label>
            Every
            <input
              inputMode="numeric"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              className="every"
            />
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="day">days</option>
              <option value="week">weeks</option>
              <option value="month">months</option>
              <option value="year">years</option>
            </select>
          </label>
        </div>
        {unit === "month" && (
          <label>
            On days of the month <span className="muted">(optional)</span>
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder={`${new Date(`${start}T00:00:00Z`).getUTCDate() || ""} (the start's day)`}
            />
          </label>
        )}
        <div className="row-fields">
          <label>
            Starts
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            Ends <span className="muted">(optional)</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        <label>
          On a weekend
          <select value={weekend} onChange={(e) => setWeekend(e.target.value as Weekend)}>
            <option value="keep">Keep the date</option>
            <option value="before">Move to the Friday before</option>
            <option value="after">Move to the Monday after</option>
          </select>
        </label>
        <p className={`small ${ruleProblem ? "error" : "muted"}`} aria-live="polite">
          {ruleProblem ??
            `${describe(rule)}. Next: ${preview.map((o) => o.date).join(", ") || "none"}`}
        </p>
        {backfill > 0 && (
          <p className="small warning">
            It starts in the past: {backfill} occurrence{backfill === 1 ? "" : "s"} since {start}{" "}
            will be staged right away.
          </p>
        )}
      </fieldset>

      <label>
        Payee
        <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Optional" />
      </label>
      <label>
        Description
        <input value={narration} onChange={(e) => setNarration(e.target.value)} />
      </label>
      <SplitsFieldset splits={splits} accounts={names} create={create} />

      <label className="check">
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
        Paused
      </label>

      {error && <p className="error">{error}</p>}

      <div className="actions pinned">
        <Link href={back} className="button">
          Back
        </Link>
        {schedule && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={async () => {
              if (!window.confirm(`Delete "${schedule.name}"? What it already staged stays.`))
                return;
              try {
                await remove.mutateAsync(schedule);
                navigate(`/books/${book}/schedules`);
              } catch (e) {
                setError(explain(e));
              }
            }}
          >
            Delete
          </button>
        )}
        <button type="submit" className="primary" disabled={!valid || save.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}
