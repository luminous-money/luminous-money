import { guessProfile, type CsvProfile } from "@fava-beans/csv-import";
import { useState, type DragEvent } from "react";
import { Link } from "wouter";

import { ImportResults } from "../components/ImportResults.js";
import { ProfileEditor } from "../components/ProfileEditor.js";
import type { ImportResult } from "../lib/appApi.js";
import { useBack, useParam } from "../lib/navigation.js";
import {
  explain,
  useImport,
  useMoneyAccounts,
  useProfile,
  useSaveProfile,
} from "../lib/queries.js";

type Stage =
  | { kind: "choose" }
  | { kind: "profile"; file: File; text: string; guess: CsvProfile }
  | { kind: "done"; result: ImportResult };

/**
 * The CSV import console: pick an account, drop in its bank's CSV. The first file for an account
 * is profiled first (how its columns map to ours), and the profile is saved for next time.
 * `?account=` picks the account to start with; `?back=` is where "‹ Back" goes.
 */
export function Import({ book }: { book: string }) {
  const accounts = useMoneyAccounts(book);
  const back = useBack("/");
  const preset = useParam("account");
  const [account, setAccount] = useState(preset ?? "");
  const chosen = account || accounts.data?.[0]?.name || "";
  const profile = useProfile(book, chosen || undefined);
  const save = useSaveProfile(book);
  const run = useImport(book);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const currency = accounts.data?.find((a) => a.name === chosen)?.currencies?.[0] ?? "USD";

  const start = async (file: File) => {
    setError(null);
    if (profile.data) return importNow(file);
    const text = await file.text();
    const guess = guessProfile(text);
    if (!guess)
      return setError(
        "That doesn't look like a bank CSV: no column of dates and amounts was found."
      );
    setStage({ kind: "profile", file, text, guess });
  };
  const importNow = async (file: File) => {
    try {
      setStage({ kind: "done", result: await run.mutateAsync({ account: chosen, file }) });
    } catch (e) {
      setError(explain(e));
      setStage({ kind: "choose" });
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void start(file);
  };

  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          {back === "/" ? "‹ Home" : "‹ Back"}
        </Link>
        <h1>Import transactions</h1>
      </header>

      {stage.kind === "done" ? (
        <>
          <ImportResults result={stage.result} book={book} currency={currency} />
          <p className="center">
            <button type="button" onClick={() => setStage({ kind: "choose" })}>
              Import another file
            </button>
          </p>
        </>
      ) : stage.kind === "profile" ? (
        <ProfileEditor
          text={stage.text}
          initial={stage.guess}
          currency={currency}
          busy={save.isPending || run.isPending}
          onCancel={() => setStage({ kind: "choose" })}
          onSave={async (p) => {
            await save.mutateAsync({ account: chosen, profile: p });
            await importNow(stage.file);
          }}
        />
      ) : (
        <section className="card stack">
          <label>
            Account
            <select
              aria-label="Account"
              value={chosen}
              onChange={(e) => setAccount(e.target.value)}
            >
              {accounts.data?.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.display_name ?? a.name}
                </option>
              ))}
            </select>
          </label>
          {chosen && !profile.isPending && (
            <p className="muted small">
              {profile.data
                ? "This account's CSV layout is known: files import straight away."
                : "First import for this account: you'll confirm how its CSV is laid out."}
            </p>
          )}
          <label
            className={`dropzone${dragging ? " dragging" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              disabled={!chosen || run.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void start(file);
              }}
            />
            <span>
              {run.isPending ? "Importing…" : "Drop a CSV file here, or tap to choose one"}
            </span>
          </label>
          {error && <p className="error">{error}</p>}
          {accounts.data?.length === 0 && (
            <p className="muted">
              No accounts to import into yet. <Link href="/accounts/new">Add one</Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
