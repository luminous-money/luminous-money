import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * What's used now and then, folded away at the bottom of a form or card: "More", with what's
 * set inside it said beside (a fund, "Not in budgets"), so folded away isn't hidden. Opens by
 * itself when what's inside needs attention (`open`), and never closes by itself: once that's
 * dealt with, it stays as it is, rather than folding away what's being worked on.
 */
export function More({
  summary,
  open = false,
  label = "More",
  children,
}: {
  summary: string[];
  open?: boolean;
  label?: string;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (open && details.current) details.current.open = true;
  }, [open]);
  return (
    <details ref={details} className="more">
      <summary>
        <span className="more-label">{label}</span>
        {summary.length > 0 && <span className="more-summary">{summary.join(" · ")}</span>}
        <ChevronDown aria-hidden="true" className="more-chevron" />
      </summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

/** What a transaction's "More" holds, said in a few words: its funds, and if it's kept out of
 * budgets. */
export function moreSummary(
  funds: { fund: string }[] | null | undefined,
  excluded: boolean
): string[] {
  return [...new Set((funds ?? []).map((l) => l.fund)), ...(excluded ? ["Not in budgets"] : [])];
}
