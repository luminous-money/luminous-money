/**
 * Migrate from another system (GnuCash, for now): the book's chart of accounts and history
 * brought in, then optionally bank feeds and the AI, the reference, rules from history, and
 * suggestions for everything uncategorized (docs/milestones/migrate-from-another-system). The
 * steps are listed with what each did; progress is kept on the server, so it can be left (to
 * wait a day for SimpleFIN, say) and picked up. Files aren't kept: a step that needs one asks
 * again. Finishing makes its entry points go.
 */
import type { Book } from "@luminous-money/ledger-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import type { ChartChoice } from "../../shared/chart.js";
import type { Migration, RuleSuggestion, Step } from "../../shared/migration.js";
import { ChartPreview, plural } from "../components/ChartPreview.js";
import { FileDrop } from "../components/FileDrop.js";
import { aiCostSentence, formatUsd } from "../lib/ai.js";
import { appApi } from "../lib/appApi.js";
import { formatDay } from "../lib/format.js";
import {
  explain,
  keys,
  useAccounts,
  useAiHealth,
  useAiSettings,
  useMigration,
  useRememberMigration,
  useRole,
} from "../lib/queries.js";
import { AiSettingsPanel } from "./AiSettings.js";
import { BankConnectionsPanel } from "./BankConnections.js";

type Files = { chart?: { name: string; text: string }; history?: { name: string; text: string } };
type Change = Parameters<typeof appApi.migration.change>[1];

const LABELS: [Step, string][] = [
  ["files", "Files"],
  ["accounts", "Accounts"],
  ["history", "History"],
  ["bank", "Bank feeds"],
  ["ai", "AI"],
  ["reference", "Reference"],
  ["rules", "Rules"],
  ["suggest", "Suggestions"],
  ["finish", "Finish"],
];

/** What a step did, in a few words, if it's been through. */
function summary(m: Migration, step: Step): string | null {
  const s = m.state;
  const range = (from: string | null, to: string | null) =>
    from && to ? `, ${formatDay(from)} to ${formatDay(to)}` : "";
  switch (step) {
    case "accounts":
      return s.accounts ? `${s.accounts.added} added, ${s.accounts.existing} already here` : null;
    case "history":
      return s.history
        ? `${plural(s.history.transactions, "transaction")}${range(s.history.from, s.history.to)}${
            s.history.problems ? ` (${s.history.problems} couldn't be read)` : ""
          }`
        : null;
    case "bank":
      return s.bank === "done" ? "Set up" : s.bank === "skipped" ? "Skipped" : null;
    case "ai":
      return s.ai === "done" ? "On" : s.ai === "skipped" ? "Skipped" : null;
    case "reference":
      return s.reference === undefined ? null : s.reference ? "Used by the AI" : "Not used";
    case "rules":
      return s.rules === "skipped" ? "Skipped" : s.rules ? `${s.rules.added} added` : null;
    case "suggest":
      if (s.suggest === "skipped") return "Skipped";
      if (!s.suggest) return null;
      return s.suggest.status === "running"
        ? `${s.suggest.done} of ${s.suggest.total} so far`
        : `${plural(s.suggest.suggested, "suggestion")}`;
    default:
      return null;
  }
}

export function Migrate({ book }: { book: Book }) {
  const migration = useMigration(book.id);
  const remember = useRememberMigration(book.id);
  const role = useRole(book.id);
  const manage = role === "owner" || role === "manage";
  const [files, setFiles] = useState<Files>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();

  /** Do something that comes back with the migration, keeping it, and saying why if it fails
   * (false). */
  const act = async (work: () => Promise<Migration | void>) => {
    setError(null);
    setBusy(true);
    try {
      const m = await work();
      if (m) remember(m);
      return true;
    } catch (e) {
      setError(explain(e));
      void client.invalidateQueries({ queryKey: ["book", book.id, "migration"] });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const m = migration.data;
  const go = (changes: Omit<Change, "updated_at">) =>
    act(() => appApi.migration.change(book.id, { ...changes, updated_at: m!.updated_at }));

  return (
    <main className="stack">
      <header className="page-head">
        <Link href={`/books/${book.id}/accounts`} className="back">
          ‹ Accounts
        </Link>
        <h1>Migrate from another system</h1>
        <p className="muted">
          Bring {book.name}&apos;s accounts and history from the books you kept before, then let
          rules, history and the AI categorize what&apos;s waiting.
        </p>
      </header>
      {migration.isPending && <p className="muted">Loading…</p>}
      {migration.error && <p className="card error">{explain(migration.error)}</p>}
      {!manage && role && <p className="card">Only the book&apos;s managers can migrate it.</p>}
      {migration.isSuccess && !m && manage && (
        <section className="card stack">
          <p>
            You&apos;ll need two exports from GnuCash: its accounts, and a year or two of its
            transactions. Nothing&apos;s added until you say so, and you can stop at any step and
            come back to it.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void act(() => appApi.migration.start(book.id, "gnucash"))}
            >
              Start, from GnuCash
            </button>
          </div>
        </section>
      )}
      {m && manage && (
        <>
          <ol className="migrate-steps" aria-label="Steps">
            {LABELS.map(([step, label]) => {
              const said = summary(m, step);
              const current = m.step === step;
              return (
                <li
                  key={step}
                  className={current ? "current" : said ? "done" : ""}
                  aria-current={current ? "step" : undefined}
                >
                  <span className="migrate-step-label">{label}</span>
                  {said && <span className="small muted"> · {said}</span>}
                </li>
              );
            })}
          </ol>
          {error && <p className="card error">{error}</p>}
          <StepView
            book={book}
            migration={m}
            files={files}
            setFiles={setFiles}
            busy={busy}
            act={act}
            go={go}
          />
          {!m.done && m.step !== "finish" && (
            <p className="small muted">
              Your progress is kept: you can leave and{" "}
              <Link href={`/books/${book.id}/accounts`}>come back to it</Link> from Accounts.
            </p>
          )}
        </>
      )}
    </main>
  );
}

type StepProps = {
  book: Book;
  migration: Migration;
  files: Files;
  setFiles: (files: Files) => void;
  busy: boolean;
  act: (work: () => Promise<Migration | void>) => Promise<boolean>;
  go: (changes: Omit<Change, "updated_at">) => Promise<boolean>;
};

/** A step's card: its title, what it's about, and its buttons. */
function StepCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card stack" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function StepView(props: StepProps) {
  switch (props.migration.step) {
    case "files":
      return <FilesStep {...props} />;
    case "accounts":
      return <AccountsStep {...props} />;
    case "history":
      return <HistoryStep {...props} />;
    case "bank":
      return <BankStep {...props} />;
    case "ai":
      return <AiStep {...props} />;
    case "reference":
      return <ReferenceStep {...props} />;
    case "rules":
      return <RulesStep {...props} />;
    case "suggest":
      return <SuggestStep {...props} />;
    case "finish":
      return <FinishStep {...props} />;
  }
}

const read = async (file: File) => ({ name: file.name, text: await file.text() });

function FilesStep({ files, setFiles, busy, go }: StepProps) {
  return (
    <StepCard title="Your GnuCash files">
      <p>In GnuCash, with your books open:</p>
      <ol className="small">
        <li>
          <strong>Accounts:</strong> File → Export → Export Account Tree to CSV.
        </li>
        <li>
          <strong>History:</strong> File → Export → Export Transactions to CSV, with every account,
          the period you want (a year or two is plenty) and <em>Simple layout</em> unchecked.
        </li>
      </ol>
      <label className="stack">
        <span>Accounts</span>
        <FileDrop
          label="GnuCash accounts file"
          chosen={files.chart?.name}
          onFile={(f) => void read(f).then((chart) => setFiles({ ...files, chart }))}
        />
      </label>
      <label className="stack">
        <span>History</span>
        <FileDrop
          label="GnuCash transactions file"
          chosen={files.history?.name}
          onFile={(f) => void read(f).then((history) => setFiles({ ...files, history }))}
        />
      </label>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || (!files.chart && !files.history)}
          onClick={() => void go({ step: files.chart ? "accounts" : "history" })}
        >
          Continue
        </button>
      </div>
    </StepCard>
  );
}

function AccountsStep({ book, files, setFiles, busy, act, go }: StepProps) {
  const accounts = useAccounts(book.id);
  const client = useQueryClient();
  const [choices, setChoices] = useState<Record<string, ChartChoice>>({});
  const [includeHidden, setIncludeHidden] = useState(false);
  const chart = files.chart;
  const upload = { text: chart?.text ?? "", include_hidden: includeHidden, choices };
  const plan = useQuery({
    queryKey: [
      "book",
      book.id,
      "migration",
      "chart",
      chart?.name,
      chart?.text.length,
      includeHidden,
      choices,
    ],
    queryFn: () => appApi.migration.previewAccounts(book.id, upload),
    enabled: !!chart,
    placeholderData: (previous) => previous,
  });
  const ours = (accounts.data ?? [])
    .filter(
      (a) =>
        (a.type === "asset" || a.type === "liability") &&
        a.kind === "leaf" &&
        !a.implicit &&
        !a.close
    )
    .map((a) => a.name);

  if (!chart)
    return (
      <StepCard title="Accounts">
        <p>Choose GnuCash&apos;s accounts export (File → Export → Export Account Tree to CSV).</p>
        <FileDrop
          label="GnuCash accounts file"
          onFile={(f) => void read(f).then((c) => setFiles({ ...files, chart: c }))}
        />
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void go({ step: "history" })}>
            Skip
          </button>
        </div>
      </StepCard>
    );
  return (
    <>
      {plan.isPending && <p className="muted">Reading {chart.name}…</p>}
      {plan.error && <p className="card error">{explain(plan.error)}</p>}
      {plan.data && (
        <ChartPreview
          plan={plan.data}
          choices={{ accounts: ours, value: choices, onChange: setChoices }}
          hidden={{ include: includeHidden, onChange: setIncludeHidden }}
          action={
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => void go({ step: "history" })}>
                Skip
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !!plan.data.error}
                onClick={() =>
                  void act(async () => {
                    const { migration } = await appApi.migration.addAccounts(book.id, upload);
                    void client.invalidateQueries({ queryKey: keys.book(book.id) });
                    return migration;
                  })
                }
              >
                {plan.data.add.length
                  ? `Add ${plural(plan.data.add.length, "account")}`
                  : "Continue"}
              </button>
            </div>
          }
        />
      )}
    </>
  );
}

function HistoryStep({ book, files, setFiles, busy, act, go }: StepProps) {
  const [said, setSaid] = useState<string | null>(null);
  const history = files.history;
  return (
    <StepCard title="History">
      <p>
        Your GnuCash transactions are kept with the book for categorizing: they&apos;re never added
        to it. Accounts are matched by the names they got in the last step.
      </p>
      {history ? (
        <p>
          <strong>{history.name}</strong>
        </p>
      ) : (
        <p className="small muted">
          Export Transactions to CSV, with every account and <em>Simple layout</em> unchecked.
        </p>
      )}
      <FileDrop
        label="GnuCash transactions file"
        chosen={history?.name}
        onFile={(f) => void read(f).then((h) => setFiles({ ...files, history: h }))}
      />
      {said && <p className="small muted">{said}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void go({ step: "bank" })}>
          Skip
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !history}
          onClick={() =>
            void act(async () => {
              const result = await appApi.migration.history(book.id, history!.text);
              if (result.problems.length)
                setSaid(`${plural(result.problems.length, "transaction")} couldn't be read.`);
              return result.migration;
            })
          }
        >
          {busy ? "Reading…" : "Read the history"}
        </button>
      </div>
    </StepCard>
  );
}

function BankStep({ book, busy, go }: StepProps) {
  const [setting, setSetting] = useState(false);
  return (
    <StepCard title="Bank feeds">
      <p>
        Your bank accounts and cards can keep themselves up to date through SimpleFIN Bridge, with
        new transactions each morning. Link them to the accounts you just brought in.
      </p>
      {setting ? (
        <>
          <BankConnectionsPanel book={book.id} />
          <p className="small muted">
            Linking brings each account&apos;s history, and SimpleFIN allows only so many requests a
            day: a long history may take until tomorrow. It carries on by itself. Come back here
            once it&apos;s in (this step waits for you).
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void go({ bank: "done", step: "ai" })}
            >
              Done with bank feeds
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void go({ bank: "skipped", step: "ai" })}
          >
            Skip
          </button>
          <button type="button" className="primary" onClick={() => setSetting(true)}>
            Set up bank feeds
          </button>
        </div>
      )}
    </StepCard>
  );
}

function AiStep({ book, migration, busy, go }: StepProps) {
  const [setting, setSetting] = useState(false);
  const health = useAiHealth();
  const settings = useAiSettings(book.id, !!health.data);
  const ready = !!settings.data?.ready;
  const next: Step = migration.state.history?.transactions ? "reference" : "rules";
  return (
    <StepCard title="AI">
      <p>
        Claude can categorize what rules and history can&apos;t, with your guidance, and read
        receipts. It needs an Anthropic API key, kept encrypted with the book.
      </p>
      {health.data === null && (
        <p className="small muted">The AI service isn&apos;t running here, so this is skipped.</p>
      )}
      {setting && <AiSettingsPanel book={book.id} />}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void go({ ai: "skipped", step: "rules" })}
        >
          {setting ? "Skip" : "No thanks"}
        </button>
        {setting ? (
          <button
            type="button"
            className="primary"
            disabled={busy || !ready}
            onClick={() => void go({ ai: "done", step: next })}
          >
            Continue with the AI
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!health.data}
            onClick={() => (ready ? void go({ ai: "done", step: next }) : setSetting(true))}
          >
            {ready ? "Continue with the AI (it's set up)" : "Set up the AI"}
          </button>
        )}
      </div>
    </StepCard>
  );
}

function ReferenceStep({ book, busy, go }: StepProps) {
  const reference = useQuery({
    queryKey: ["book", book.id, "migration", "reference"],
    queryFn: () => appApi.migration.reference(book.id),
  });
  const r = reference.data;
  return (
    <StepCard title="Reference">
      <p>
        Your history, summed up by payee: where each one&apos;s transactions went, how often and for
        how much, recent ones counting more. Given to the AI with every batch it categorizes, for
        the payees in it, so it categorizes as you did. It keeps up by itself: as you confirm
        transactions here, they count too.
      </p>
      {reference.isPending && <p className="muted">Working it out…</p>}
      {reference.error && <p className="error">{explain(reference.error)}</p>}
      {r && (
        <>
          <p>
            <strong>{plural(r.payees, "payee")}</strong> from{" "}
            {plural(r.imported, "imported transaction")}
            {r.from && r.to ? ` (${formatDay(r.from)} to ${formatDay(r.to)})` : ""}, and this
            book&apos;s own.
          </p>
          <ul className="chart-plan" aria-label="Most frequent payees">
            {r.top.map((p) => (
              <li key={p.payee}>
                <strong className="chart-plan-name">{p.payee}</strong>
                <span className="small muted"> · {plural(p.seen, "time")}</span>
                <span className="small muted chart-plan-details">
                  {p.accounts.map((a) => `${a.account} ${Math.round(a.share * 100)}%`).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void go({ reference: false, step: "rules" })}
        >
          Skip
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !r?.payees}
          onClick={() => void go({ reference: true, step: "rules" })}
        >
          Use it
        </button>
      </div>
    </StepCard>
  );
}

const ruleId = (r: RuleSuggestion) => `${r.match}:${r.key}`;

function RulesStep({ book, busy, act, go }: StepProps) {
  const suggestions = useQuery({
    queryKey: ["book", book.id, "migration", "rules"],
    queryFn: () => appApi.migration.rules(book.id),
  });
  const [off, setOff] = useState<Set<string>>(new Set());
  const list = suggestions.data ?? [];
  const chosen = list.filter((r) => !off.has(ruleId(r)));
  return (
    <StepCard title="Rules">
      <p>
        Payees your history nearly always put in one account, as rules: they categorize those payees
        as they arrive (still for you to confirm). Untick any you don&apos;t want.
      </p>
      {suggestions.isPending && <p className="muted">Looking…</p>}
      {suggestions.error && <p className="error">{explain(suggestions.error)}</p>}
      {suggestions.isSuccess && !list.length && (
        <p className="muted">No payee is consistent enough for a rule.</p>
      )}
      {list.length > 0 && (
        <ul className="chart-plan" aria-label="Suggested rules">
          {list.map((r) => (
            <li key={ruleId(r)}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!off.has(ruleId(r))}
                  onChange={(e) => {
                    const next = new Set(off);
                    if (e.target.checked) next.delete(ruleId(r));
                    else next.add(ruleId(r));
                    setOff(next);
                  }}
                />
                <span>
                  <strong>{r.payee}</strong> → {r.account}
                </span>
              </label>
              <span className="small muted chart-plan-details">
                {r.matched} of {r.seen} times
                {r.waiting > 0 && ` · ${plural(r.waiting, "transaction")} waiting`}
                {r.match === "contains" && ` · when the description has “${r.key}”`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void go({ rules: "skipped", step: "suggest" })}
        >
          Skip
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !chosen.length}
          onClick={() =>
            void act(async () => (await appApi.migration.addRules(book.id, chosen)).migration)
          }
        >
          Add {plural(chosen.length, "rule")}
        </button>
      </div>
    </StepCard>
  );
}

function SuggestStep({ book, migration, busy, act, go }: StepProps) {
  const waiting = useQuery({
    queryKey: ["book", book.id, "migration", "uncategorized"],
    queryFn: () => appApi.migration.uncategorized(book.id),
  });
  const job = migration.state.suggest === "skipped" ? undefined : migration.state.suggest;
  const running = job?.status === "running";
  return (
    <StepCard title="Suggestions">
      {!job && (
        <p>
          {waiting.data
            ? `${plural(waiting.data.count, "transaction")} ${waiting.data.count === 1 ? "is" : "are"} uncategorized.`
            : "Counting what's uncategorized…"}{" "}
          Suggest categories for them all: your rules, then history (yours and what you brought in)
          {migration.state.ai === "done" ? ", then the AI" : ""}. They stay unconfirmed, for you to
          check in review.
        </p>
      )}
      {job && (
        <div role="status">
          {running ? (
            <>
              <p>
                Suggesting… {job.done} of {job.total}
                {job.ai ? " (the AI answers 20 at a time)" : ""}
              </p>
              <progress max={job.total || 1} value={job.done} />
            </>
          ) : (
            <p>
              {job.status === "done"
                ? `${plural(job.suggested, "transaction")} of ${job.total} got a suggestion.`
                : job.status === "stopped"
                  ? `Stopped after ${job.done} of ${job.total} (the server restarted).`
                  : `It failed: ${job.error}`}
            </p>
          )}
          {job.ai_error && <p className="small error">The AI couldn&apos;t help: {job.ai_error}</p>}
          {typeof job.ai_cost === "number" && (
            <p className="small muted">
              {running
                ? `So far, the AI's part has cost about ${formatUsd(job.ai_cost)}.`
                : aiCostSentence(job.ai_cost)}
            </p>
          )}
        </div>
      )}
      <div className="actions">
        {!running && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void go(job ? { step: "finish" } : { suggest: "skipped", step: "finish" })
            }
          >
            {job ? "Continue" : "Skip"}
          </button>
        )}
        {(!job || job.status !== "done") && !running && (
          <button
            type="button"
            className="primary"
            disabled={busy || !waiting.data?.count}
            onClick={() => void act(() => appApi.migration.suggest(book.id))}
          >
            {job ? "Suggest again" : "Suggest categories"}
          </button>
        )}
        {job?.status === "done" && job.suggested > 0 && (
          <Link href={`/books/${book.id}/review`} className="button primary-link">
            Review them
          </Link>
        )}
      </div>
    </StepCard>
  );
}

function FinishStep({ book, migration, busy, go }: StepProps) {
  const [, navigate] = useLocation();
  const job = migration.state.suggest === "skipped" ? undefined : migration.state.suggest;
  return (
    <StepCard title={migration.done ? "Done" : "Finish"}>
      <ul className="small">
        {LABELS.slice(1, -1).map(([step, label]) => {
          const said = summary(migration, step);
          return (
            <li key={step}>
              {label}: {said ?? "not reached"}
            </li>
          );
        })}
      </ul>
      {migration.done ? (
        <p>This book has been migrated.</p>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void go({ done: true }).then(
                (ok) =>
                  ok && navigate(job?.suggested ? `/books/${book.id}/review` : `/books/${book.id}`)
              )
            }
          >
            Finish
          </button>
        </div>
      )}
    </StepCard>
  );
}
