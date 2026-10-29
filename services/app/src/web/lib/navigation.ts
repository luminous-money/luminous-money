import { useSearch } from "wouter";

/** A query parameter of the current page's URL. */
export function useParam(name: string): string | null {
  return new URLSearchParams(useSearch()).get(name);
}

/** Every value of a repeated query parameter (`?tag=a&tag=b`), in order. */
export function useParams(name: string): string[] {
  return new URLSearchParams(useSearch()).getAll(name);
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
