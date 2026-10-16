/**
 * Linking in the background. Fetching a bank account's history can take minutes (the Bridge
 * answers some banks slowly, and a long history is many 45-day windows), so a link is an
 * attempt first:
 *
 * 1. The user chooses the bank account, the account in the book, and how to start. That's
 *    checked at once (`precheck`) and recorded.
 * 2. The history is fetched in the background. If today's requests run out, the attempt waits,
 *    and carries on with the next morning's sync.
 * 3. With the history in, the attempt's preview is worked out, and it waits for the user, who
 *    can have left the page meanwhile.
 * 4. Confirming plans again (from what's fetched, so with current versions) and links.
 *
 * Attempts survive restarts: unfinished ones are picked up when the app starts.
 */
import { LinkProblem, plan, precheck, type LinkInput, type LinkMode } from "./link.js";
import type { Attempt, Link } from "./store.js";
import { backfill, type SimplefinDeps } from "./sync.js";

const running = new Set<string>();

function inputOf(deps: SimplefinDeps, attempt: Attempt): LinkInput | undefined {
  const connection = deps.store.connection(attempt.user_id, attempt.connection_id);
  return (
    connection && {
      user: attempt.user_id,
      connection,
      accountId: attempt.account_id,
      book: attempt.book_id,
      account: attempt.account,
      mode: attempt.mode as LinkMode,
      from: attempt.from_date ?? undefined,
    }
  );
}

/** Fetch an attempt's history and work out its preview. */
export async function runAttempt(deps: SimplefinDeps, attempt: Attempt): Promise<void> {
  const { store } = deps;
  const input = inputOf(deps, attempt);
  if (!input) return store.deleteAttempt(attempt.id);
  store.setAttempt(attempt.id, "fetching");
  try {
    if (!(await backfill(deps, input.connection, input.accountId)))
      return store.setAttempt(attempt.id, "waiting");
    const { preview } = await plan(deps, input, { fetch: false });
    store.setAttempt(attempt.id, "ready", { preview });
  } catch (error) {
    store.setAttempt(attempt.id, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Run an attempt in the background (once at a time). */
export function startAttempt(deps: SimplefinDeps, attempt: Attempt): void {
  if (running.has(attempt.id)) return;
  running.add(attempt.id);
  void runAttempt(deps, attempt).finally(() => running.delete(attempt.id));
}

/** Pick up every unfinished attempt: at startup, and each morning (for those that ran out). */
export function resumeAttempts(deps: SimplefinDeps): number {
  const attempts = deps.store.unfinishedAttempts();
  for (const attempt of attempts) startAttempt(deps, attempt);
  return attempts.length;
}

/** Record a link attempt (checked first) and start fetching for it. */
export async function attemptLink(deps: SimplefinDeps, input: LinkInput): Promise<Attempt> {
  await precheck(deps, input);
  const attempt = deps.store.addAttempt({
    user_id: input.user,
    connection_id: input.connection.id,
    account_id: input.accountId,
    book_id: input.book,
    account: input.account,
    mode: input.mode,
    from_date: input.from ?? null,
  });
  startAttempt(deps, attempt);
  return attempt;
}

/** Confirm a ready attempt: link, from what's been fetched. */
export async function confirmAttempt(deps: SimplefinDeps, attempt: Attempt): Promise<Link> {
  if (attempt.state !== "ready")
    throw new LinkProblem(409, "this link isn't ready yet: the bank's history is still coming");
  const input = inputOf(deps, attempt);
  if (!input) throw new LinkProblem(404, "its connection is gone");
  const link = await (await plan(deps, input, { fetch: false })).apply();
  deps.store.deleteAttempt(attempt.id);
  return link;
}

/** Whether no attempt is running right now (tests wait on it). */
export const idle = () => running.size === 0;
