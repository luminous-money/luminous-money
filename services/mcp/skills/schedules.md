# Luminous Money: schedules

A schedule stages a transaction on every occurrence of its recurrence: rent, a paycheck, a
subscription. Occurrences arrive **staged** (for review) unless `auto_confirm`, and a bank row
that matches one is matched to it rather than staged twice.

- **Recurrence** (`rule`): every N days, weeks, months or years from `start`, until `until` (or
  null). Months fall on the start's day, or on the listed `days` (-1 is the last); a day past a
  month's end clamps to its last. `weekend` says where a Saturday or Sunday goes: `keep`,
  `before` (the Friday) or `after` (the Monday).
- **Template:** the transaction without a date or flag: payee, narration, splits (one may leave
  out `units` to balance), fund lines. A split's `tolerance` lets a bank amount that differs by
  up to that still match (a utility bill that varies).
- New schedules stage what's already due from their start. `write_run_schedules` stages
  what's due now (it's done hourly anyway). Changes apply to occurrences still to come; what was
  staged stays.
- `read_upcoming` lists occurrences over the next days, which the app shows greyed in ledgers.
- A loan's payment schedule belongs to the loan (the loans skill).
