import { useState } from "react";

import { addMonths, monthName, spanName, thisMonth, type MonthSpan } from "../lib/months.js";
import { usePopover } from "../lib/popover.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Quick spans, each through this month. */
const PRESETS: [string, (now: string) => MonthSpan][] = [
  ["This month", (now) => ({ from: now, through: now })],
  ["3 months", (now) => ({ from: addMonths(now, -2), through: now })],
  ["6 months", (now) => ({ from: addMonths(now, -5), through: now })],
  ["12 months", (now) => ({ from: addMonths(now, -11), through: now })],
  ["This year", (now) => ({ from: `${now.slice(0, 4)}-01`, through: now })],
  ["All time", (now) => ({ from: "start", through: now })],
];

/**
 * A range of months, as a button that reads it ("Nov 2026", "Jun 2026 – Nov 2026")
 * and opens a year of months to pick it from: a first tap picks a month alone, a second the
 * other end. Any years, ahead too (what reads the range stops at today). Quick spans above.
 */
export function MonthRange({
  value,
  onChange,
  label,
}: {
  value: MonthSpan;
  onChange: (span: MonthSpan) => void;
  /** What the range is of, for screen readers: "Months". */
  label: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const now = thisMonth();
  const [year, setYear] = useState(Number(value.through.slice(0, 4)));
  // The first tap's month, waiting for the other end.
  const [start, setStart] = useState<string | null>(null);
  const toggle = () => {
    setYear(Number(value.through.slice(0, 4)));
    setStart(null);
    setOpen((o) => !o);
  };
  const choose = (span: MonthSpan) => {
    onChange(span);
    setOpen(false);
  };
  const pick = (month: string) => {
    if (start === null) {
      setStart(month);
      onChange({ from: month, through: month });
    } else {
      choose(month < start ? { from: month, through: start } : { from: start, through: month });
    }
  };
  const name = spanName(value);
  const from = value.from === "start" ? null : value.from;
  return (
    <div className="menu month-range" ref={ref}>
      <button
        type="button"
        className="month-range-button"
        aria-label={`${label}: ${name}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <span>{name}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="menu-panel month-range-panel" role="dialog" aria-label={label}>
          <div className="month-presets" role="group" aria-label="Quick spans">
            {PRESETS.map(([text, span]) => {
              const s = span(now);
              const on = s.from === value.from && s.through === value.through;
              return (
                <button
                  key={text}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => choose(s)}
                >
                  {text}
                </button>
              );
            })}
          </div>
          <div className="month-year">
            <button
              type="button"
              className="plain"
              aria-label="The year before"
              onClick={() => setYear((y) => y - 1)}
            >
              ‹
            </button>
            <strong>{year}</strong>
            <button
              type="button"
              className="plain"
              aria-label="The year after"
              onClick={() => setYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
          <div className="month-grid" role="group" aria-label={String(year)}>
            {MONTHS.map((short, i) => {
              const month = `${year}-${String(i + 1).padStart(2, "0")}`;
              const inside = (from === null || month >= from) && month <= value.through;
              const edge = month === from || month === value.through;
              return (
                <button
                  key={month}
                  type="button"
                  aria-label={monthName(month)}
                  aria-pressed={inside}
                  className={[
                    inside ? "inside" : "",
                    edge ? "edge" : "",
                    month === now ? "now" : "",
                  ].join(" ")}
                  onClick={() => pick(month)}
                >
                  {short}
                </button>
              );
            })}
          </div>
          <p className="small muted month-hint">Choose a start and end month (can be the same)</p>
        </div>
      )}
    </div>
  );
}
