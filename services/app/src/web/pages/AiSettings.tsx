/**
 * A book's AI (M16): on or off, the provider and the API key it uses (a person's: shared
 * connections; never shown again), whether receipts are itemized by default, whether the AI may
 * open accounts (how eagerly, with what guidance), and whether it suggests tags (HSA tracking).
 * Managers change them, putting one of their own keys in the book; a key's owner can always take
 * it out; members see them. If the ai service is down, it says so: nothing AI is offered until
 * it's back.
 */
import { useState } from "react";

import { formatUsd, type AiSettings as Settings, type Eagerness } from "../lib/ai.js";
import {
  explain,
  useAiHealth,
  useAiKeys,
  useAiSettings,
  useAiUsage,
  useBooks,
  useClearAiKey,
  useDeleteAiKey,
  useMembers,
  usePatchAi,
  useRole,
  useSetAiKey,
} from "../lib/queries.js";
import { Loading } from "../components/Loading.js";
import { Crumbs } from "../components/Crumbs.js";

const EAGERNESS: [Eagerness, string][] = [
  ["reluctant", "Reluctant: only when nothing fits"],
  ["average", "Average: when nothing fits well"],
  ["aggressive", "Aggressive: whenever a new one describes it better"],
];

export function AiSettings({ book }: { book: string }) {
  return (
    <main className="stack">
      <header className="page-head">
        <Crumbs />
        <h1>AI</h1>
        <p className="muted">Reading receipts into transactions, for this book.</p>
      </header>
      <AiSettingsPanel book={book} />
    </main>
  );
}

/** The page's settings, also a migration's AI step. */
export function AiSettingsPanel({ book }: { book: string }) {
  const health = useAiHealth();
  const settings = useAiSettings(book, !!health.data);
  const role = useRole(book);
  const manage = role === "owner" || role === "manage";
  return (
    <>
      {health.isPending && <Loading />}
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
      {health.data && <Spending book={book} />}
    </>
  );
}

const OPERATIONS = {
  extract: ["receipt read", "receipts read"],
  categorize: ["categorizing request", "categorizing requests"],
  "loan-table": ["loan schedule read", "loan schedules read"],
} as const;

/** What the book's AI has cost this month (UTC), estimated from what each call reported. */
function Spending({ book }: { book: string }) {
  const usage = useAiUsage(book);
  if (!usage.data) return null;
  const { usd, calls, operations, month } = usage.data;
  const name = new Date(`${month}-01T00:00:00Z`).toLocaleString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <section className="card" aria-label="This month">
      <h2 className="section-title">This month</h2>
      {calls === 0 ? (
        <p className="muted">Nothing yet in {name}.</p>
      ) : (
        <>
          <p>
            About <strong>{formatUsd(usd)}</strong> so far in {name}
            {operations.length > 0 &&
              `: ${operations
                .map((o) => {
                  const [one, many] = OPERATIONS[o.operation];
                  return `${o.count} ${o.count === 1 ? one : many} (${formatUsd(o.usd)})`;
                })
                .join(", ")}`}
            .
          </p>
          <p className="small muted">
            An estimate at Anthropic&apos;s list prices, from what each call reported; the Claude
            Console&apos;s billing has the real figure.
          </p>
        </>
      )}
    </section>
  );
}

/** Whose key the book uses, as a phrase: "your key", "Jess's key", "the book's key". */
function useWhose(book: string, settings: Settings) {
  const members = useMembers(book);
  const { mine, owner_id } = settings.credential;
  if (mine) return "your key";
  if (!owner_id) return "the book's key";
  const name = members.data?.members.find((m) => m.user_id === owner_id)?.name;
  return name ? `${name}${name.endsWith("s") ? "'" : "'s"} key` : "another member's key";
}

/** The book's API key: whose it uses (never which), a manager's choice of their own or a new
 * one of theirs, and taking it out (a manager, or the key's owner). */
function KeyChoice({
  book,
  settings,
  manage,
}: {
  book: string;
  settings: Settings;
  manage: boolean;
}) {
  const setKey = useSetAiKey(book);
  const clearKey = useClearAiKey(book);
  const keys = useAiKeys(manage);
  const whose = useWhose(book, settings);
  const [key, setKeyText] = useState("");
  const { set, hint, mine } = settings.credential;
  // A book uses one key: the caller's others, to choose from.
  const others = (keys.data ?? []).filter((k) => !k.books.includes(book));
  const [chosen, setChosen] = useState("");
  const error = setKey.error ?? clearKey.error;
  return (
    <div className="key-choice">
      <p className="small">
        {set ? (
          <>
            Uses {whose}, <span className="muted">…{hint}</span>
          </>
        ) : (
          <span className="muted">No API key yet.</span>
        )}{" "}
        {set && (manage || mine) && (
          <button
            type="button"
            className="plain"
            disabled={clearKey.isPending}
            onClick={() => clearKey.mutate(undefined)}
          >
            {mine && !manage ? "Take yours out" : "Remove"}
          </button>
        )}
      </p>
      {manage && others.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen)
              setKey.mutate({ credential_id: chosen }, { onSuccess: () => setChosen("") });
          }}
        >
          <label>
            One of your keys
            <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Choose…</option>
              {others.map((k) => (
                <option key={k.id} value={k.id}>
                  …{k.hint}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!chosen || setKey.isPending}>
            Use it here
          </button>
        </form>
      )}
      {manage && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim())
              setKey.mutate({ api_key: key.trim() }, { onSuccess: () => setKeyText("") });
          }}
        >
          <label>
            {set ? "A new key of yours" : "Your API key"}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKeyText(e.target.value)}
              placeholder="sk-ant-…"
              aria-label="API key"
            />
          </label>
          <button type="submit" disabled={!key.trim() || setKey.isPending}>
            {set ? "Replace" : "Save"}
          </button>
        </form>
      )}
      <p className="small muted">
        A key is yours: kept encrypted on your server and never shown again, used in the books you
        put it in (each book&apos;s spending is below, and the Claude Console bills you). From the
        Claude Console (API keys).
      </p>
      {error && <p className="error">{explain(error)}</p>}
    </div>
  );
}

/** The caller's own keys: the books using each, and deleting one (from all of them). */
function YourKeys() {
  const keys = useAiKeys();
  const books = useBooks();
  const remove = useDeleteAiKey();
  if (!keys.data?.length) return null;
  const name = (id: string) => books.data?.find((b) => b.id === id)?.name ?? "another book";
  return (
    <section className="card" aria-label="Your keys">
      <h2 className="section-title">Your keys</h2>
      <ul className="plain-list">
        {keys.data.map((k) => (
          <li key={k.id} className="row-between">
            <span>
              …{k.hint}
              <span className="small muted block">
                {k.books.length ? `Used in ${k.books.map(name).join(", ")}` : "Not used in a book"}
              </span>
            </span>
            <button
              type="button"
              className="plain danger"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    k.books.length
                      ? "Delete this key? The books using it will have none."
                      : "Delete this key?"
                  )
                )
                  remove.mutate(k.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {remove.error && <p className="error">{explain(remove.error)}</p>}
    </section>
  );
}

function Form({ book, settings, manage }: { book: string; settings: Settings; manage: boolean }) {
  const patch = usePatchAi(book);
  const health = useAiHealth();
  const [guidance, setGuidance] = useState(settings.guidance ?? "");
  const change = (changes: Partial<Settings>) =>
    patch.mutate({ ...changes, updated_at: settings.updated_at } as never);
  const providers = health.data?.providers ?? ["claude"];
  const error = patch.error;
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
          <KeyChoice book={book} settings={settings} manage={manage} />
        )}
      </section>
      <YourKeys />

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

      <section className="card editor" aria-label="Tags">
        <h2 className="section-title">Tags</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.suggest_tags}
            disabled={!manage || patch.isPending}
            onChange={(e) => change({ suggest_tags: e.target.checked })}
          />
          Suggest tags
        </label>
        <p className="small muted">
          The book&rsquo;s own tags, where its history says so, and #hsa-fsa-eligible on what an HSA
          or FSA can pay for. Amazon&rsquo;s &ldquo;FSA or HSA eligible&rdquo; items are tagged
          either way.
        </p>
      </section>
      {error && <p className="error">{explain(error)}</p>}
      {!manage && <p className="small muted">Only a manager of the book can change these.</p>}
    </>
  );
}
