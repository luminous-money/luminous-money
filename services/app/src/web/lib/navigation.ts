import { useSearch } from "wouter";

/** A query parameter of the current page's URL. */
export function useParam(name: string): string | null {
  return new URLSearchParams(useSearch()).get(name);
}

/** Where a page's "‹ Back" goes: the `back` parameter (a path in the app), or `fallback`. */
export function useBack(fallback: string): string {
  const back = useParam("back");
  return back && back.startsWith("/") ? back : fallback;
}

/** A link to `path` that comes back here. */
export function withBack(path: string, here: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}back=${encodeURIComponent(here)}`;
}
