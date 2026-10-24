import { useReceiptsReady } from "../lib/queries.js";

/** What "Suggest categories" did (rules and history, over everything unconfirmed), and with the
 * book's AI set up, how to ask it too: a selection's bulk action does (Actions → Suggest
 * categories), so a book's whole queue isn't sent to it at once. */
export function SuggestNote({ book, suggested }: { book: string; suggested: number }) {
  const aiReady = useReceiptsReady(book);
  return (
    <p className="muted small" aria-live="polite">
      {suggested ? `Suggested categories for ${suggested}.` : "Nothing new to suggest."}
      {aiReady &&
        " To ask the book's AI too, choose them in Select mode: Actions → Suggest categories."}
    </p>
  );
}
