M3: Scheduled transactions: plan
==================================================================================================

> **Status: built (2026-10-13), with the [answers](#answers-2026-10-13-built) to its first
> pass.** Every slice is done, with unit, API and browser tests. There's no separate
> spec: the milestone's line in [the plan](../../PLAN.md) ("the editor, storage, generator
> logic, and display considerations") and the design's
> [scheduled transactions](../../design.md#scheduled-transactions) section are the brief. Calls
> marked **Proposed** were built as described, and are listed again under the questions where
> they're worth a second look.

## What M3 is

A **schedule** is a transaction template plus a recurrence: rent on the 1st, salary on the 15th
and the last day, a subscription every year. When an occurrence comes due, the **generator**
stages it in the ledger as a pending (`!`) transaction, just as an import would. From there,
everything M1 and M2 built applies:

- It shows in the account's ledger and counts in its balance (pending counts).
- **When the bank's CSV arrives, the row matches it** (same account, same amount, ±5 days), so
  nothing is added twice, and the match is confirmed in review.
- With no bank feed (rent paid by check), it's confirmed in review like any staged transaction.

M3 is single-book. Schedules whose legs straddle books (the salary case in the design) are M9.

## Decisions this plan makes

### Recurrence

- **A small rule, not RRULE** (**Proposed**): every *N* days, weeks, months or years, from a
  start date, until an optional end date.
  - **Weeks** fall on the start date's weekday ("every 2 weeks on Friday").
  - **Months** fall on the start date's day, or on **listed days of the month** ("1, 15" for
    twice a month; "last" for the last day). Days past a month's end clamp to its last day (the
    31st in February is the 28th or 29th).
  - **Years** fall on the start date (Feb 29 clamps to the 28th in other years).
- **Weekends** (**Proposed**): an occurrence on a Saturday or Sunday can stay, move to the Friday
  before, or move to the Monday after (salary is usually paid the business day before). No
  holiday calendar.
- **One shared module** (`src/shared/schedule.ts`) computes occurrences and describes the rule
  in words ("Every month on the 1st and 15th"), so the server generates and the browser
  previews with the same code.

### Storage (in `app`)

- **Schedules belong to `app`,** as the design says: a `schedule` table (id, owner, book, name,
  rule, weekend handling, start, end, paused, the transaction template as JSON, the last error,
  and a **generated-through** date), and a `schedule_occurrence` table (schedule, nominal date,
  the date it was staged on, and the transaction created).
- **The template** is a transaction without a date or flag: payee, description, tags, links,
  metadata, and postings (one amount may be left blank to balance). Accounts are checked on
  save: they must exist and be open leaves.
- **Edits are versioned** like everything else (`updated_at`, 409 on a stale one), and apply to
  future occurrences only. Transactions already staged stay as they are.
- **Deleting a schedule** stops it; the transactions it created stay in the books.

### The generator

- **It runs inside `app`:** at startup, every hour, and right after a schedule is saved. It acts
  as the schedule's owner toward the ledger (passing `X-User-Id` inside the stack, as imports
  do).
- **An occurrence is due on its (weekend-adjusted) date:** it's staged on the day, not before
  (**Proposed**; lead time is a question). After downtime, it catches up on everything missed.
- **Each occurrence is staged once.** The generator only considers nominal dates after the
  schedule's generated-through date, and records each occurrence it stages. So:
  - deleting a staged occurrence (to skip it) doesn't bring it back
  - editing the rule never backfills dates in the past
  - **a new schedule whose start is in the past does backfill** from its start (**Proposed**:
    the start date is the user's choice), with a warning in the editor when it would
- **The staged transaction** has the occurrence's date, the template's payee, description and
  postings, flag `!`, and metadata `schedule: <id>` and `schedule-date: <nominal date>`.
- **Failures don't stop other schedules.** A schedule whose transaction the ledger refuses (an
  account closed since, say) keeps its error, shown on the Schedules page, and is retried on the
  next run.

### The PWA

- **A Schedules page** (in the menu):
  - each schedule's name, rule in words, next date, and amount; paused and failing ones marked
  - **Upcoming:** every occurrence in the next 16 days, across schedules (first built with
    30; changed 2026-10-13)
  - "New schedule"
- **The schedule editor:**
  - name; the transaction (payee, description, and the same splits editor as the transaction
    page, factored out to share); the rule (every *N* units, days of the month, start, optional
    end, weekends); pause; delete
  - a preview of the next few dates
- **"Repeat…" on a transaction** opens a new schedule prefilled from it: monthly, starting a
  month after its date.
- **Ledgers mark scheduled transactions** with ↻ (from `app`'s occurrences), so you can tell a
  prediction from a bank row.

### Matching

Nothing new: a generated transaction is an ordinary transaction in the account, not held by any
import, so M2's matcher finds it. An end-to-end test proves it: schedule rent, let it generate,
import the bank's rent row, and it matches.

## How it gets built

1. **Recurrence:** the shared module, with unit tests (month ends, leap years, listed days,
   weekends, end dates, descriptions).
2. **Storage and API:** app migration 6; `GET/POST /books/:book/schedules`,
   `GET/PATCH/DELETE /books/:book/schedules/:id`, `GET /books/:book/schedules/upcoming`,
   `GET /books/:book/schedules/occurrences` (transaction IDs, for the ↻ marks), `POST
   /books/:book/schedules/run` (run the generator for the book now).
3. **The generator:** due occurrences, catch-up, once-only, errors kept; on a timer and after
   saves. Unit tests against the fake ledger.
4. **The PWA:** the shared splits editor; the Schedules page with Upcoming; the editor with its
   preview; "Repeat…"; ↻ in ledgers.
5. **Tests end to end:** API (create, generate, edit without backfill, pause, delete; a generated
   transaction matched by an import) and browser (a schedule made with "Repeat…" stages its
   occurrences, marked in the ledger).
6. **Docs:** design.md, this status, `docs/PLAN.md`, RESUME.md.

## Out of scope for M3

- **Schedules across books** (the salary case): M9.
- **Estimated amounts** that vary per occurrence, and matching them within a tolerance: see the
  questions.
- **Projected balances** and future occurrences in ledgers: see the questions.
- **Holiday calendars.**

## Answers (2026-10-13), built

- **The generator runs daily** (not hourly): at startup, after edits, and once a day, just after
  midnight in each book's time zone.
- **Creating a schedule** stages every occurrence from its start through today (as built).
- **Match tolerance per split** (question 1): each split of a template can carry a tolerance, an
  amount either way, default 0, set in the schedule editor. An imported row matches a
  scheduled transaction's split if it's within that tolerance. On confirming the match, the
  bank's amount replaces the split's, and the blank split (if any) absorbs the difference.
- **Upcoming occurrences show in ledgers** as grayed rows above the transactions, with a
  projected running balance (question 2).
- **Confirm automatically,** per schedule (question 3): its occurrences are staged confirmed.
- **Time zone is a book setting,** in `app`, defaulting to the browser's when the book is
  created (question 4); the generator and "upcoming" use it.
- **No rules beyond the current ones** (question 6).
- **"Not this time"** (question 7), distinct from review's "Skip" (which only puts a card off):
  - the schedule's `last_applied` date (was `generated_through`) is the last nominal date it ran
    for; the generator starts after it, or at the start date if it has never run
  - "Not this time" deletes a pending occurrence; it doesn't come back, since the schedule
    already ran for that date
  - **editing a schedule** resets `last_applied` to now (yesterday, so today's occurrence is
    staged by the edited schedule), and deletes its unconfirmed occurrences dated today or
    later (except ones an import already matched), so they're staged again as edited
- **Deleting a schedule** keeps what it staged, without ↻ marks (question 8: fine).

## Questions (first pass)

The questions as first asked, answered above.


Decided by best guess in the first pass, or left out. Most consequential first.

1. **Estimated amounts.** Salary, utilities and card payments vary. The design calls for marking
   template amounts as estimates, matching an import within a tolerance, and taking the bank's
   amount. _Not built:_ want it, and with what tolerance (±10%? a fixed amount?), and which split
   absorbs the difference when the bank's amount wins (for salary: the net deposit, against
   gross pay)?
2. **When an occurrence is staged.** It's staged on its date, so it doesn't count in balances
   before it happens. _Alternatives:_ stage it a few days ahead (future-dated, so the ledger
   shows what's coming, but balances include it early); or show upcoming occurrences in ledgers
   as virtual rows, with a projected balance.
3. **Confirming occurrences without a bank feed** (rent by check): they wait in review like any
   staged transaction. Want a per-schedule "confirm automatically" for trusted ones?
4. **The generator's "today"** is the server's date: UTC in the containers, so an occurrence due
   on the 1st is staged at 7 p.m. Central on the 31st. _Proposed:_ a `TZ` setting for the
   household's time zone in Compose (defaulting to the host's).
5. **Backfill:** a new schedule starting in the past stages everything since its start (with a
   warning in the editor). Right, or should it start from today unless asked?
6. **Rules not covered:** "the second Tuesday", "the last Friday", business days with holidays.
   Wanted?
7. **Skipping an occurrence** is deleting its staged transaction (it won't come back). Worth a
   "Skip" button in review for scheduled transactions?
8. **Deleting a schedule** keeps what it staged, but drops their ↻ marks (the transactions keep
   `schedule` metadata). Fine?
