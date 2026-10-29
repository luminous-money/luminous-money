/**
 * Tags (M17): Beancount's `#tag`s on transactions. `TagChips` shows a transaction's, read-only;
 * `TagInput` chooses some: the chosen ones as chips with ×, and an input that suggests the
 * book's tags as you type (most used first), adding a suggestion, or what you typed (made a tag
 * by `toTag`), on Enter, Tab or a comma.
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
  const matches = useMemo(() => {
    const words = query.toLowerCase().replace(/^#/, "").trim();
    return [...choices]
      .filter((c) => !value.includes(c.name) && c.name.includes(words))
      .sort((a, b) => (b.transactions ?? 0) - (a.transactions ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((c) => c.name);
  }, [choices, query, value]);
  const options =
    allowNew && typed && !matches.includes(typed) && !value.includes(typed)
      ? [...matches, typed]
      : matches;

  const add = (tag: string) => {
    if (!value.includes(tag)) onChange([...value, tag]);
    setQuery("");
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const choice = open && query ? options[active] : undefined;
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, options.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && choice) add(choice);
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
          aria-expanded={open && !!query && options.length > 0}
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
        {open && query && options.length > 0 && (
          <ul id={listId} role="listbox" aria-label={label}>
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
