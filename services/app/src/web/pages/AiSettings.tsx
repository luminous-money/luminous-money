/**
 * A book's AI (M16): on or off, the provider and its API key (set or replaced, never shown
 * again), whether receipts are itemized by default, and whether the AI may open accounts (how
 * eagerly, with what guidance). Managers change them; members see them. If the ai service is
 * down, it says so: nothing AI is offered until it's back.
 */
import { useState } from "react";
import { Link } from "wouter";

import type { AiSettings as Settings, Eagerness } from "../lib/ai.js";
import { bookHome } from "../lib/books.js";
import {
  explain,
  useAiHealth,
  useAiSettings,
  useClearAiKey,
  usePatchAi,
  useRole,
  useSetAiKey,
} from "../lib/queries.js";

const EAGERNESS: [Eagerness, string][] = [
  ["reluctant", "Reluctant: only when nothing fits"],
  ["average", "Average: when nothing fits well"],
  ["aggressive", "Aggressive: whenever a new one describes it better"],
];

export function AiSettings({ book }: { book: string }) {
  const health = useAiHealth();
  const settings = useAiSettings(book, !!health.data);
  const role = useRole(book);
  const manage = role === "owner" || role === "manage";
  return (
    <main className="stack">
      <header className="page-head">
        <Link href={bookHome(book)} className="back">
          ‹ Home
        </Link>
        <h1>AI</h1>
        <p className="muted">Reading receipts into transactions, for this book.</p>
      </header>
      {health.isPending && <p className="muted">Loading…</p>}
      {health.data === null && (
        <p className="card">
          The AI service isn't running, so nothing AI is offered. Everything else works as usual.
        </p>
      )}
      {settings.error && <p className="card error">{explain(settings.error)}</p>}
      {settings.data && (
        <Form
          key={settings.data.updated_at ?? "new"}
          book={book}
          settings={settings.data}
          manage={manage}
        />
      )}
    </main>
  );
}

function Form({ book, settings, manage }: { book: string; settings: Settings; manage: boolean }) {
  const patch = usePatchAi(book);
  const setKey = useSetAiKey(book);
  const clearKey = useClearAiKey(book);
  const health = useAiHealth();
  const [key, setKeyText] = useState("");
  const [guidance, setGuidance] = useState(settings.guidance ?? "");
  const change = (changes: Partial<Settings>) =>
    patch.mutate({ ...changes, updated_at: settings.updated_at } as never);
  const providers = health.data?.providers ?? ["claude"];
  const error = patch.error ?? setKey.error ?? clearKey.error;
  return (
    <>
      <section className="card editor" aria-label="AI">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!manage || patch.isPending}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          Use AI in this book
        </label>
        <p className="small muted">
          {settings.ready
            ? "Ready: the camera at the top of every page captures a receipt."
            : settings.enabled
              ? "Almost: it needs the provider's API key."
              : "Off: receipts are made from what you type."}
        </p>
        <label>
          Provider
          <select
            value={settings.provider}
            disabled={!manage || patch.isPending}
            onChange={(e) => change({ provider: e.target.value as Settings["provider"] })}
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {p === "claude" ? "Claude (Anthropic)" : p === "fake" ? "Fake (test stacks)" : p}
              </option>
            ))}
          </select>
        </label>
        {settings.provider === "claude" && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) setKey.mutate(key.trim(), { onSuccess: () => setKeyText("") });
            }}
          >
            <label>
              API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                disabled={!manage}
                onChange={(e) => setKeyText(e.target.value)}
                placeholder={
                  settings.credential.set ? `Set: …${settings.credential.hint}` : "sk-ant-…"
                }
                aria-label="API key"
              />
            </label>
            <button type="submit" disabled={!manage || !key.trim() || setKey.isPending}>
              {settings.credential.set ? "Replace" : "Save"}
            </button>
            {settings.credential.set && (
              <button
                type="button"
                className="plain"
                disabled={!manage || clearKey.isPending}
                onClick={() => clearKey.mutate(undefined)}
              >
                Remove
              </button>
            )}
          </form>
        )}
        <p className="small muted">
          Kept encrypted on your server and never shown again. From the Claude Console (API keys).
        </p>
      </section>

      <section className="card editor" aria-label="Receipts">
        <h2 className="section-title">Receipts</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.itemize}
            disabled={!manage || patch.isPending}
            onChange={(e) => change({ itemize: e.target.checked })}
          />
          Itemize receipts by default
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.create_accounts}
            disabled={!manage || patch.isPending}
            onChange={(e) => change({ create_accounts: e.target.checked })}
          />
          Let the AI open accounts it thinks a receipt needs
        </label>
        {settings.create_accounts && (
          <>
            <label>
              How eagerly
              <select
                value={settings.eagerness}
                disabled={!manage || patch.isPending}
                onChange={(e) => change({ eagerness: e.target.value as Eagerness })}
              >
                {EAGERNESS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Guidance
              <textarea
                rows={4}
                value={guidance}
                disabled={!manage}
                onChange={(e) => setGuidance(e.target.value)}
                onBlur={() =>
                  guidance.trim() !== (settings.guidance ?? "") &&
                  change({ guidance: guidance.trim() || null })
                }
                placeholder="I like detailed, deep hierarchies: say what, not why."
              />
            </label>
          </>
        )}
      </section>
      {error && <p className="error">{explain(error)}</p>}
      {!manage && <p className="small muted">Only a manager of the book can change these.</p>}
    </>
  );
}
