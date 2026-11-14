/** What's still on its way: a spinner and a word, said to screen readers too. It fades in after
 * a moment, so what loads quickly never flashes it. `page`: a whole page's, centered in the
 * room it will take. */
export function Loading({ label = "Loading…", page = false }: { label?: string; page?: boolean }) {
  return (
    <p className={`loading${page ? " loading-page" : ""}`} role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}
