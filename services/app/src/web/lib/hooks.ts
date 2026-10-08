import type { Account, Transaction, TransactionIn } from "@fava-beans/ledger-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "./ledger.js";

export type Loadable<T> =
  { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; error: string };

/** Load once per change of `key`; `reload` refetches. */
export function useLoad<T>(key: string, load: () => Promise<T>) {
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult({ state: "loading" });
    load().then(
      (value) => !cancelled && setResult({ state: "ready", value }),
      (error: Error) => !cancelled && setResult({ state: "failed", error: error.message })
    );
    return () => {
      cancelled = true;
    };
    // `load` is recreated every render; `key` says when it actually changes.
  }, [key, attempt]);
  return [result, () => setAttempt((n) => n + 1)] as const;
}

export function useAccounts(book: string) {
  return useLoad<Account[]>(`accounts:${book}`, () => api.accounts(book))[0];
}

const skippedKey = (book: string) => `fava-beans:skipped:${book}`;

function readSkipped(book: string): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(skippedKey(book)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * The review queue: staged transactions, oldest first. Skipping moves an item to the end without
 * changing it; skips last for the browser session. Saving keeps an item staged; confirming saves
 * it with the `*` flag, which takes it out of the queue.
 */
export function useQueue(book: string) {
  const [loaded, reload] = useLoad(`queue:${book}`, () => api.staged(book));
  const [items, setItems] = useState<Transaction[]>([]);
  const [skipped, setSkipped] = useState<string[]>(() => readSkipped(book));

  useEffect(() => {
    if (loaded.state === "ready") setItems(loaded.value);
  }, [loaded]);

  useEffect(() => {
    sessionStorage.setItem(skippedKey(book), JSON.stringify(skipped));
  }, [book, skipped]);

  const ordered = [
    ...items.filter((t) => !skipped.includes(t.id)),
    ...skipped.flatMap((id) => items.filter((t) => t.id === id)),
  ];

  const skip = useCallback((id: string) => {
    setSkipped((s) => [...s.filter((x) => x !== id), id]);
  }, []);

  const save = useCallback(
    async (id: string, input: TransactionIn) => {
      const saved = await api.save(book, id, input);
      setItems((all) =>
        saved.flag === "!"
          ? all.map((t) => (t.id === id ? saved : t))
          : all.filter((t) => t.id !== id)
      );
      if (saved.flag !== "!") setSkipped((s) => s.filter((x) => x !== id));
      return saved;
    },
    [book]
  );

  const confirm = useCallback(
    (id: string, input: TransactionIn) => save(id, { ...input, flag: "*" }),
    [save]
  );

  return { loaded, reload, items: ordered, skip, save, confirm };
}
