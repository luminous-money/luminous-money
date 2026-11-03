/**
 * Work that outlasts a request: reading a receipt (M16) is a minute or more of AI calls, and a
 * proxy in front of the app cuts a request off before that (Emmer's nginx gave up at 60 seconds,
 * 2026-11-02, and the PWA saw a bare 504). A caller that sends `Prefer: respond-async` gets 202
 * and the job's ID at once, and asks after it (`GET /books/:book/jobs/:id`) until it's done: each
 * ask is quick, so no timeout reaches it, and it says which step the work is on.
 *
 * Jobs live in memory, for an hour after they finish. A restart loses them; asking after one
 * then says so (404), and that the work may have finished before it.
 */
import { randomUUID } from "node:crypto";

/** A job as its caller sees it. */
export type JobView<T> = { id: string } & (
  | { state: "running"; step: string | null }
  | { state: "done"; result: T }
  | { state: "failed"; status: number; detail: string }
);

type Job = {
  book: string;
  user: string;
  finished: number | null;
  view: JobView<unknown>;
};

/** Why work failed, as a status and a sentence for the caller. */
export type Failure = { status: number; detail: string };

export class Jobs {
  private readonly jobs = new Map<string, Job>();

  constructor(
    /** How long a finished job is kept to be asked after (ms). */
    private readonly keep = 60 * 60 * 1000,
    private readonly now = () => Date.now()
  ) {}

  /**
   * Start `work` for a user's book, and hand back its ID. `work` reports its steps as it goes;
   * `failure` says what an error it throws means.
   */
  start<T>(
    book: string,
    user: string,
    work: (step: (step: string) => void) => Promise<T>,
    failure: (error: unknown) => Failure
  ): string {
    this.prune();
    const id = randomUUID();
    const job: Job = { book, user, finished: null, view: { id, state: "running", step: null } };
    this.jobs.set(id, job);
    const step = (name: string) => {
      if (job.view.state === "running") job.view = { id, state: "running", step: name };
    };
    void work(step).then(
      (result) => this.finish(job, { id, state: "done", result }),
      (error: unknown) => {
        const { status, detail } = failure(error);
        console.error(`job ${id} (book ${book}) failed: ${detail}`);
        this.finish(job, { id, state: "failed", status, detail });
      }
    );
    return id;
  }

  /** A job, if it's this user's on this book and still kept. */
  get(id: string, book: string, user: string): JobView<unknown> | undefined {
    this.prune();
    const job = this.jobs.get(id);
    return job && job.book === book && job.user === user ? job.view : undefined;
  }

  private finish(job: Job, view: JobView<unknown>) {
    job.view = view;
    job.finished = this.now();
  }

  private prune() {
    const before = this.now() - this.keep;
    for (const [id, job] of this.jobs)
      if (job.finished !== null && job.finished < before) this.jobs.delete(id);
  }
}

/** Whether a request asks for its work in the background (RFC 7240's `Prefer: respond-async`). */
export const wantsAsync = (prefer: string | undefined) =>
  !!prefer && /(^|[,\s])respond-async($|[,;\s])/i.test(prefer);
