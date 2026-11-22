/**
 * Tags (M17), a split's since 2026-11-12. `TagChips` shows a split's or a transaction's (its
 * splits' together), read-only; `TagInput` chooses some: the chosen ones as chips with ×, and an
 * input that suggests the book's tags as you type (most used first), adding a suggestion, or what
 * you typed (made a tag by `toTag`), on Enter, Tab or a comma. `TagChecklist` edits a selection's
 * tags (Select mode's Edit tags…).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { toTag } from "../../shared/tags.js";

/** Tags in words: "#italy and #work", "#a, #b and #c". */
export function tagList(tags: readonly string[]): string {
  const named = tags.map((tag) => `#${tag}`);
  return named.length < 2
    ? (named[0] ?? "")
    : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

/** A tag change in words: "Added #italy and removed #work". */
export function tagChangeSaid({ add, remove }: TagChange): string {
  const said = [
    add.length ? `added ${tagList(add)}` : "",
    remove.length ? `removed ${tagList(remove)}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** A tag that might be suggested, with how many transactions have it (most used first). */
export type TagChoice = { name: string; transactions?: number };

export function TagChips({ tags }: { tags?: readonly string[] }) {
  if (!tags?.length) return null;
  return (
    <span className="tags" aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="tag">
          #{tag}
        </span>
      ))}
    </span>
  );
}

/**
 * Tags as chips, and a combobox to add more: the choices matching what's typed (a part of a
 * name, `#` or not), most used first. Adding (`allowNew`), what's typed can be a new tag, and
 * the list waits for typing. Filtering, only the choices can be chosen, so the list opens with
 * every one as soon as it's focused, narrows as you type, and says when nothing matches.
 */
export function TagInput({
  label,
  value,
  onChange,
  choices,
  allowNew = true,
  placeholder,
  autoFocus,
  disabled,
}: {
  label: string;
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** What to suggest: the book's tags, say. */
  choices: readonly TagChoice[];
  /** Whether a tag that isn't among the choices may be added (not for filters). */
  allowNew?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const typed = toTag(query);
  const browse = !allowNew;
  const matches = useMemo(() => {
    const words = query.toLowerCase().replace(/^#/, "").trim();
    return [...choices]
      .filter((c) => !value.includes(c.name) && c.name.includes(words))
      .sort((a, b) => (b.transactions ?? 0) - (a.transactions ?? 0) || a.name.localeCompare(b.name))
      .slice(0, browse ? undefined : 8)
      .map((c) => c.name);
  }, [choices, query, value, browse]);
  const options =
    allowNew && typed && !matches.includes(typed) && !value.includes(typed)
      ? [...matches, typed]
      : matches;
  // Open: what's typed has options, or filtering, there are choices (or it says none match).
  const listed = open && (!!query || browse);
  const none = listed && options.length === 0 && !!query && browse;
  const shown = listed && (options.length > 0 || none);

  const add = (tag: string) => {
    if (!value.includes(tag)) onChange([...value, tag]);
    setQuery("");
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const choice = listed ? options[active] : undefined;
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, options.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    // Tab and comma take a choice only for what's typed: tabbing past an empty filter adds nothing.
    else if ((e.key === "Enter" || ((e.key === "," || e.key === "Tab") && query)) && choice)
      add(choice);
    else if (e.key === ",") {
      // Commas separate tags; they're never part of one.
    } else if (e.key === "Enter" && query) {
      // Nothing to add: don't submit the form around it either.
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  };

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="tag">
          #{tag}
          <button
            type="button"
            className="plain"
            aria-label={`Remove #${tag}`}
            disabled={disabled}
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <span className="picker">
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={shown}
          aria-controls={listId}
          placeholder={placeholder ?? (value.length ? "" : allowNew ? "Add a tag" : "Choose a tag")}
          value={query}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {shown && (
          <ul id={listId} role="listbox" aria-label={label}>
            {none && <li className="muted none">No tags match</li>}
            {options.map((tag, i) => (
              <li
                key={tag}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: it fires before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(tag);
                }}
              >
                #{tag}
                {!choices.some((c) => c.name === tag) && <span className="muted"> (new)</span>}
              </li>
            ))}
          </ul>
        )}
      </span>
    </div>
  );
}

/** What a tag change does to a selection: tags put on all of them, and taken off all of them. */
export type TagChange = { add: string[]; remove: string[] };

/** A tag across a selection: on all of them, some of them, or none. */
type Coverage = "all" | "some" | "none";

/**
 * Select mode's Edit tags…: a searchable checklist of tags, each one's box checked when all of
 * the selection have it, `–` when only some do, and empty when none do. The tags any of them has
 * come first (most common first), then the book's others; typing one the book doesn't have yet
 * offers it. A tap on a row puts the tag on all of them, or (checked) takes it off all of them;
 * a `–` one goes to checked, then empty, then back to `–` (left as it is on each). **Save** sends
 * only what changed, so a `–` left alone stays as it is on each one; a tap anywhere outside the
 * list saves too, and **Cancel** (or Escape) leaves everything as it was.
 */
export function TagChecklist({
  total,
  have,
  choices,
  onSave,
  onCancel,
}: {
  /** How many are selected. */
  total: number;
  /** The tags the selection has, each with how many of them have it. */
  have: readonly TagChoice[];
  /** The book's tags. */
  choices: readonly TagChoice[];
  onSave: (change: TagChange) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  // What's been tapped: a tag's new coverage, where it isn't what it was.
  const [chosen, setChosen] = useState<Map<string, "all" | "none">>(new Map());
  const [created, setCreated] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const was = useMemo(
    () =>
      new Map<string, Coverage>(
        have.map((t) => [t.name, (t.transactions ?? 0) >= total ? "all" : "some"])
      ),
    [have, total]
  );
  // In the order they were when the list opened, so a row doesn't move when it's tapped.
  const rows = useMemo(() => {
    const byUse = (a: TagChoice, b: TagChoice) =>
      (b.transactions ?? 0) - (a.transactions ?? 0) || a.name.localeCompare(b.name);
    const theirs = [...have].sort(byUse).map((t) => t.name);
    const others = [...choices]
      .filter((c) => !was.has(c.name))
      .sort(byUse)
      .map((c) => c.name);
    return { theirs: [...created, ...theirs], others: others.filter((t) => !created.includes(t)) };
  }, [have, choices, was, created]);

  const coverage = (tag: string): Coverage => chosen.get(tag) ?? was.get(tag) ?? "none";
  const choose = (tag: string, to: Coverage) =>
    setChosen((m) => {
      const next = new Map(m);
      if (to === (was.get(tag) ?? "none")) next.delete(tag);
      else next.set(tag, to as "all" | "none");
      return next;
    });
  const tap = (tag: string) => {
    const now = coverage(tag);
    choose(
      tag,
      now === "all" ? "none" : now === "some" || was.get(tag) !== "some" ? "all" : "some"
    );
  };
  const create = (tag: string) => {
    setCreated((c) => [tag, ...c]);
    choose(tag, "all");
    setQuery("");
  };

  const change = (): TagChange => ({
    add: [...chosen].filter(([, to]) => to === "all").map(([tag]) => tag),
    remove: [...chosen].filter(([, to]) => to === "none").map(([tag]) => tag),
  });
  const save = () => {
    const c = change();
    if (c.add.length || c.remove.length) onSave(c);
    else onCancel();
  };
  // A tap outside saves: the listener reads the latest choices through a ref.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const outside = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && saveRef.current();
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  const words = query.toLowerCase().replace(/^#/, "").trim();
  const matching = (tags: string[]) => tags.filter((t) => t.includes(words));
  const theirs = matching(rows.theirs);
  const others = matching(rows.others);
  const typed = toTag(query);
  const offer =
    typed && !rows.theirs.includes(typed) && !rows.others.includes(typed) ? typed : null;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter taps what's typed, else the first match, else adds what's typed: as TagInput takes
    // a suggestion before a new tag.
    const shown = [...theirs, ...others];
    const first = typed && shown.includes(typed) ? typed : shown[0];
    if (e.key === "Escape") onCancel();
    else if (e.key === "Enter" && query && first) tap(first);
    else if (e.key === "Enter" && offer) create(offer);
    else if (e.key !== "Enter") return;
    e.preventDefault();
  };

  const row = (tag: string, first = false) => {
    const now = coverage(tag);
    const count = have.find((t) => t.name === tag)?.transactions ?? 0;
    return (
      <li key={tag} className={first ? "tag-checks-break" : undefined}>
        <button
          type="button"
          role="checkbox"
          aria-checked={now === "all" ? true : now === "some" ? "mixed" : false}
          className="tag-check"
          onClick={() => tap(tag)}
        >
          <span className="tag-box" aria-hidden="true">
            {now === "all" ? "✓" : now === "some" ? "–" : ""}
          </span>
          <span className="tag-check-name">#{tag}</span>
          {now === "some" && (
            <span className="small muted">
              {count} of {total}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="tag-checklist" ref={ref} role="group" aria-label="Edit tags">
      <input
        type="search"
        aria-label="Find or add a tag"
        placeholder="Find or add a tag"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul className="tag-checks">
        {theirs.map((tag) => row(tag))}
        {others.map((tag, i) => row(tag, i === 0 && theirs.length > 0))}
        {offer && (
          <li>
            <button type="button" className="tag-check create" onClick={() => create(offer)}>
              <span className="tag-box" aria-hidden="true">
                +
              </span>
              <span className="tag-check-name">Add #{offer}</span>
            </button>
          </li>
        )}
        {!offer && !theirs.length && !others.length && (
          <li className="muted none">{query ? "No tags match" : "No tags yet: type one"}</li>
        )}
      </ul>
      <div className="tag-checklist-actions">
        <button type="button" className="primary" onClick={save}>
          Save
        </button>
        <button type="button" className="plain" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
