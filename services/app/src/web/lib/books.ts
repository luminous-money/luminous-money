/**
 * The selected book: the one in the URL (`/books/:book/…`), which every page works in. The last
 * one used is remembered per device (and per user), so `/` opens it again.
 */
import { useLocation } from "wouter";

import type { BookInfo } from "./appApi.js";

const key = (user: string) => `fava-beans:last-book:${user}`;

/** The book ID in the current path, if any. */
export function useBookInPath(): string | undefined {
  const [location] = useLocation();
  const id = /^\/books\/([^/?]+)/.exec(location)?.[1];
  return id === undefined ? undefined : decodeURIComponent(id);
}

export function rememberBook(user: string, book: string): void {
  localStorage.setItem(key(user), book);
}

/** The book `/` opens: the last one used here, if it's still one of the user's, else the first. */
export function startingBook(user: string, books: BookInfo[]): BookInfo | undefined {
  const last = localStorage.getItem(key(user));
  return books.find((b) => b.id === last) ?? books[0];
}

/** The book to point menus at: the one in the path, else the one `/` would open. */
export function useSelectedBook(user: string, books: BookInfo[]): BookInfo | undefined {
  const inPath = useBookInPath();
  return books.find((b) => b.id === inPath) ?? startingBook(user, books);
}

/** A book's home page. */
export const bookHome = (book: string) => `/books/${encodeURIComponent(book)}`;
