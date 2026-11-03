import { describe, expect, it } from "vitest";

import { Jobs, wantsAsync } from "./jobs.js";

/** A promise to settle by hand, and its settling functions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const failure = (error: unknown) => ({ status: 422, detail: (error as Error).message });

describe("jobs", () => {
  it("runs work in the background: its steps, then what it made", async () => {
    const jobs = new Jobs();
    const work = deferred<{ transaction_id: string }>();
    let step!: (name: string) => void;
    const id = jobs.start("book", "kael", (report) => ((step = report), work.promise), failure);
    expect(jobs.get(id, "book", "kael")).toEqual({ id, state: "running", step: null });
    step("reading");
    expect(jobs.get(id, "book", "kael")).toEqual({ id, state: "running", step: "reading" });
    work.resolve({ transaction_id: "t1" });
    await settled();
    expect(jobs.get(id, "book", "kael")).toEqual({
      id,
      state: "done",
      result: { transaction_id: "t1" },
    });
  });

  it("says why work failed, with the status its error means", async () => {
    const jobs = new Jobs();
    const id = jobs.start(
      "book",
      "kael",
      () => Promise.reject(new Error("a receipt is at most 25 MB")),
      failure
    );
    await settled();
    expect(jobs.get(id, "book", "kael")).toEqual({
      id,
      state: "failed",
      status: 422,
      detail: "a receipt is at most 25 MB",
    });
  });

  it("shows a job only to whoever started it, on its book", () => {
    const jobs = new Jobs();
    const id = jobs.start("book", "kael", () => new Promise(() => {}), failure);
    expect(jobs.get(id, "book", "someone-else")).toBeUndefined();
    expect(jobs.get(id, "another-book", "kael")).toBeUndefined();
    expect(jobs.get("no-such-job", "book", "kael")).toBeUndefined();
  });

  it("forgets finished jobs after a while, never running ones", async () => {
    let now = 0;
    const jobs = new Jobs(1000, () => now);
    const done = jobs.start("book", "kael", () => Promise.resolve(1), failure);
    const running = jobs.start("book", "kael", () => new Promise(() => {}), failure);
    await settled();
    now = 999;
    expect(jobs.get(done, "book", "kael")?.state).toBe("done");
    now = 2000;
    expect(jobs.get(done, "book", "kael")).toBeUndefined();
    expect(jobs.get(running, "book", "kael")?.state).toBe("running");
  });
});

it("reads Prefer: respond-async among other preferences", () => {
  expect(wantsAsync("respond-async")).toBe(true);
  expect(wantsAsync("return=minimal, respond-async")).toBe(true);
  expect(wantsAsync("respond-async; wait=10")).toBe(true);
  expect(wantsAsync("return=minimal")).toBe(false);
  expect(wantsAsync(undefined)).toBe(false);
});
