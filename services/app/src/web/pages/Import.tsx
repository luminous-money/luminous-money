import { guessProfile, type CsvProfile } from "@fava-beans/csv-import";
import { useState, type DragEvent } from "react";
import { Link } from "wouter";

import { ImportResults } from "../components/ImportResults.js";
import { ProfileEditor } from "../components/ProfileEditor.js";
import { displayName } from "../lib/accounts.js";
import { ImportError, type ImportResult } from "../lib/appApi.js";
import { useBack, useParam } from "../lib/navigation.js";
import {
  explain,
  useImport,
  useAccounts,
  useStars,
  useProfiles,
  useSaveProfile,
} from "../lib/queries.js";

/** A new profile replaces the account's saved ones, or is added alongside them. */
type Mode = "replace" | "add";

type Stage =
  | { kind: "choose" }
  | { kind: "mismatch"; file: File }
  | { kind: "profile"; file: File; text: string; guess: CsvProfile; mode: Mode }
  | { kind: "done"; result: ImportResult };

/**
 * The CSV import console: pick an account, drop in its bank's CSV. The first file for an account
 * is profiled first (how its columns map to ours), and the profile is saved for next time. A
 * file that fits none of the account's saved profiles asks whether it's really for this account,
 * and if so, profiles it to replace the saved ones or to add to them.
 * Any open leaf account can be imported into; starred ones are listed first.
 * `?account=` picks the account to start with; `?back=` is where "‹ Back" goes.
 */
export function Import({ book }: { book: string }) {
  const all = useAccounts(book);
  const stars = useStars(book);
  const open = (all.data ?? []).filter((a) => a.kind === "leaf" && !a.implicit && !a.close);
  const starred = (stars.data ?? []).flatMap((name) => open.filter((a) => a.name === name));
  const others = open.filter((a) => !stars.data?.includes(a.name));
  const back = useBack("/");
  const preset = useParam("account");
  const [account, setAccount] = useState(preset ?? "");
  const chosen = account || starred[0]?.name || others[0]?.name || "";
  const profiles = useProfiles(book, chosen || undefined);
  const saved = profiles.data?.length ?? 0;
  const save = useSaveProfile(book);
  const run = useImport(book);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const target = open.find((a) => a.name === chosen);
  const currency = target?.currencies?.[0] ?? "USD";

  const start = async (file: File) => {
    setError(null);
    return saved ? importNow(file) : profileFile(file, "replace");
  };
  const profileFile = async (file: File, mode: Mode) => {
    const text = await file.text();
    const guess = guessProfile(text);
    if (!guess) {
      setStage({ kind: "choose" });
      return setError(
        "That doesn't look like a bank CSV: no column of dates and amounts was found."
      );
    }
    setStage({ kind: "profile", file, text, guess, mode });
  };
  const importNow = async (file: File) => {
    try {
      setStage({ kind: "done", result: await run.mutateAsync({ account: chosen, file }) });
    } catch (e) {
      if (e instanceof ImportError && e.code === "wrong-layout") {
        return setStage({ kind: "mismatch", file });
      }
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
      ) : stage.kind === "mismatch" ? (
        <section className="card stack" aria-label="File format mismatch">
          <p>
            The uploaded file doesn't match{" "}
            {saved > 1 ? "any of the saved formats" : "the saved format"} for this account. Are you
            sure this file is for the account '{displayName(target ?? { name: chosen })}'?
          </p>
          <div className="choices">
            <button type="button" onClick={() => void profileFile(stage.file, "replace")}>
              Yes, replace saved format{saved > 1 ? "s" : ""}
            </button>
            <button type="button" onClick={() => void profileFile(stage.file, "add")}>
              Yes, this is an additional format for this account
            </button>
            <button type="button" onClick={() => setStage({ kind: "choose" })}>
              Cancel
            </button>
          </div>
        </section>
      ) : stage.kind === "profile" ? (
        <ProfileEditor
          text={stage.text}
          initial={stage.guess}
          currency={currency}
          type={target?.type}
          busy={save.isPending || run.isPending}
          onCancel={() => setStage({ kind: "choose" })}
          onSave={async (p) => {
            await save.mutateAsync({ account: chosen, profile: p, mode: stage.mode });
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
              {starred.length > 0 && (
                <optgroup label="Starred">
                  {starred.map((a) => (
                    <option key={a.name} value={a.name}>
                      {displayName(a)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={starred.length ? "Other accounts" : "Accounts"}>
                {others.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {chosen && !profiles.isPending && (
            <p className="muted small">
              {saved === 0
                ? "First import for this account: you'll confirm how its CSV is laid out."
                : saved === 1
                  ? "This account's CSV layout is known: files import straight away."
                  : `This account has ${saved} known CSV layouts: files in any of them import straight away.`}
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
          {all.data && open.length === 0 && (
            <p className="muted">
              No accounts to import into yet. <Link href="/accounts/new">Add one</Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
