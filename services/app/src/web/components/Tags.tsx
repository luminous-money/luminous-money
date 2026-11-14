/**
 * Tags (M17), a split's since 2026-11-12. `TagChips` shows a split's or a transaction's (its
 * splits' together), read-only; `TagInput` chooses some: the chosen ones as chips with ×, and an
 * input that suggests the book's tags as you type (most used first), adding a suggestion, or what
 * you typed (made a tag by `toTag`), on Enter, Tab or a comma.
 */
import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { toTag } from "../../shared/tags.js";

/** Tags in words: "#italy and #work", "#a, #b and #c". */
export function tagList(tags: readonly string[]): string {
  const named = tags.map((tag) => `#${tag}`);
  return named.length < 2
    ? (named[0] ?? "")
    : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
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
