import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { cents, money } from "../../shared/loans.js";
import { LoanConfirm } from "../components/LoanConfirm.js";
import {
  ExtrasStep,
  ForStep,
  HistoryStep,
  PaymentStep,
  TermsStep,
  type StepProps,
} from "../components/LoanSetupSteps.js";
import { inChart } from "../components/Loans.js";
import { today } from "../lib/format.js";
import {
  accountsOf,
  defaultPaying,
  emptyDraft,
  forgetDraft,
  keepDraft,
  readDraft,
  requestOf,
  stepProblem,
  stepsOf,
  type Context,
  type LoanDraft,
  type Step,
} from "../lib/loan-setup.js";
import { useBack } from "../lib/navigation.js";
import {
  explain,
  useAccounts,
  useBankStatus,
  useBooks,
  useSaveLoan,
  useStars,
  useSummary,
} from "../lib/queries.js";

const TITLES: Record<Step, string> = {
  for: "What it's for",
  terms: "Terms",
  extras: "Extras",
  history: "Payments so far",
  payment: "Payment",
  confirm: "Check it over",
};

/**
 * New loan: a questionnaire, one step a screen (what it's for, its terms, what's paid with it,
 * its payments so far, how it's paid), then a page to check it all over. Nothing is made until
 * Confirm, which sends it all at once; the answers are kept for the browser's session.
 */
export function LoanSetup({ book }: { book: string }) {
  const back = useBack(`/books/${book}/loans`);
  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>New loan</h1>
      </header>
      <Questionnaire book={book} back={back} />
    </main>
  );
}

function Questionnaire({ book, back }: { book: string; back: string }) {
  const [, navigate] = useLocation();
  const chart = useAccounts(book);
  const stars = useStars(book);
  const bank = useBankStatus(book);
  const save = useSaveLoan(book);
  const currency = useBooks().data?.find((b) => b.id === book)?.currency ?? "USD";
  const now = today();

  const kept = useMemo(() => readDraft(book), [book]);
  const [draft, setDraft] = useState<LoanDraft>(kept?.draft ?? emptyDraft());
  const [step, setStep] = useState<Step>(kept?.step ?? "for");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => keepDraft(book, draft, step), [book, draft, step]);

  const accounts = chart.data ?? [];
  const paying = useMemo(
    () => defaultPaying(accounts, stars.data ?? [], new Set(Object.keys(bank.data ?? {}))),
    [accounts, stars.data, bank.data]
  );
  const liability = accountsOf(draft).liability;
  const existing = draft.kind && inChart(accounts, liability);
  const owedNow = useSummary(book, existing ? [liability] : undefined).data?.[0]?.balance.find(
    (b) => cents(b.number) !== 0n
  );
  const ctx: Context = {
    chart: accounts,
    today: now,
    currency,
    paying,
    owesAlready: !!owedNow,
  };

  const steps = stepsOf(draft, now);
  const at = Math.max(steps.indexOf(step), 0);
  const current = steps[at]!;
  const set = (patch: Partial<LoanDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };
  const go = (to: Step) => {
    setProblem(null);
    setStep(to);
    window.scrollTo(0, 0);
  };

  const submit = async () => {
    setError(null);
    try {
      const made = await save.mutateAsync({ loan: requestOf(draft, ctx) });
      forgetDraft(book);
      navigate(`/books/${book}/loans/${made.id}`, { replace: true });
    } catch (e) {
      setError(explain(e));
      void chart.refetch(); // anything opened before it failed is in the chart now
    }
  };
  const next = () => {
    const missing = stepProblem(current, draft, ctx);
    if (missing) return setProblem(missing);
    if (current === "confirm") return void submit();
    go(steps[at + 1]!);
  };
  const startOver = () => {
    forgetDraft(book);
    setDraft(emptyDraft());
    go("for");
  };

  const props: StepProps = { draft, set, ctx };
  return (
    <form
      className="editor loan-setup"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <div
        className="setup-progress"
        role="progressbar"
        aria-label="New loan's steps"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={at + 1}
        aria-valuetext={`Step ${at + 1} of ${steps.length}: ${TITLES[current]}`}
      >
        {steps.map((s, i) => (
          <span key={s} className={i <= at ? "reached" : ""} />
        ))}
      </div>
      <p className="small muted setup-step">
        Step {at + 1} of {steps.length} · {TITLES[current]}
      </p>

      {current === "for" && <ForStep {...props} />}
      {current === "terms" && <TermsStep {...props} />}
      {current === "extras" && <ExtrasStep {...props} />}
      {current === "history" && <HistoryStep {...props} />}
      {current === "payment" && <PaymentStep {...props} />}
      {current === "confirm" && (
        <LoanConfirm {...props} go={go} owed={owedNow ? money(-cents(owedNow.number)) : null} />
      )}

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions pinned">
        {at > 0 ? (
          <button type="button" onClick={() => go(steps[at - 1]!)}>
            Back
          </button>
        ) : (
          <Link href={back} className="button">
            Cancel
          </Link>
        )}
        {(at > 0 || draft.purpose) && (
          <button type="button" className="link-button" onClick={startOver}>
            Start over
          </button>
        )}
        <button type="submit" className="primary" disabled={save.isPending}>
          {current === "confirm"
            ? save.isPending
              ? "Confirming…"
              : "Confirm"
            : current === "terms"
              ? "Looks right"
              : "Next"}
        </button>
      </div>
    </form>
  );
}
