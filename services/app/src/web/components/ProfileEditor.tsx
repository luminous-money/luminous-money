import {
  applyProfile,
  DATE_FORMATS,
  parseCsv,
  type CsvProfile,
  type DateFormat,
} from "@luminous-money/csv-import";
import type { Account } from "@luminous-money/ledger-client";
import { useMemo, useState } from "react";

import { shown, shownInverted } from "../lib/accounts.js";
import { formatMoney } from "../lib/decimal.js";

type Props = {
  text: string;
  initial: CsvProfile;
  currency: string;
  /** The account's type, so the preview shows amounts as its ledger will (see `shown`). */
  type?: Account["type"];
  busy?: boolean;
  onSave: (profile: CsvProfile) => void;
  onCancel: () => void;
};

const OPTIONAL = -1;

/**
 * Say how an account's CSV export is laid out: which column is the date (and its format), the
 * amount (one signed column, or money out and money in), the description, and optionally a
 * payee, the bank's transaction ID and a running balance. Starts from a guess; a live preview
 * shows how the first rows would be read.
 */
export function ProfileEditor({ text, initial, currency, type, busy, onSave, onCancel }: Props) {
  const [profile, setProfile] = useState(initial);
  const rows = useMemo(() => applyProfile(text, profile).slice(0, 8), [text, profile]);
  const sample = useMemo(() => {
    const { rows: cells } = parseCsv(text, profile.delimiter);
    return cells.slice(
      profile.skip + (profile.header ? 1 : 0),
      profile.skip + (profile.header ? 1 : 0) + 3
    );
  }, [text, profile]);

  const label = (i: number) => {
    const example = sample.map((r) => r[i]).find(Boolean);
    return `${profile.columns[i]}${example ? ` (e.g. ${example.slice(0, 24)})` : ""}`;
  };
  const columnSelect = (
    name: string,
    value: number | null,
    onChange: (v: number | null) => void,
    optional = false
  ) => (
    <label>
      {name}
      <select
        aria-label={name}
        value={value ?? OPTIONAL}
        onChange={(e) =>
          onChange(Number(e.target.value) === OPTIONAL ? null : Number(e.target.value))
        }
      >
        {optional && <option value={OPTIONAL}>None</option>}
        {profile.columns.map((_, i) => (
          <option key={i} value={i}>
            {label(i)}
          </option>
        ))}
      </select>
    </label>
  );
  const set = (change: Partial<CsvProfile>) => setProfile((p) => ({ ...p, ...change }));
  const amount = profile.amount;
  const readable = rows.filter((r) => !r.error).length;

  return (
    <section className="card stack" aria-label="CSV profile">
      <h2 className="section-title">How is this file laid out?</h2>
      <p className="muted small">
        This is saved with the account and used for every file you import into it.
      </p>

      <div className="profile-grid">
        {columnSelect("Date", profile.date.column, (v) =>
          set({ date: { ...profile.date, column: v ?? 0 } })
        )}
        <label>
          Date format
          <select
            aria-label="Date format"
            value={profile.date.format}
            onChange={(e) =>
              set({ date: { ...profile.date, format: e.target.value as DateFormat } })
            }
          >
            {DATE_FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          Amounts
          <select
            aria-label="Amounts"
            value={amount.kind}
            onChange={(e) =>
              set({
                amount:
                  e.target.value === "signed"
                    ? {
                        kind: "signed",
                        column: amount.kind === "signed" ? amount.column : amount.debit,
                        negate: false,
                      }
                    : {
                        kind: "split",
                        debit: amount.kind === "split" ? amount.debit : amount.column,
                        credit: amount.kind === "split" ? amount.credit : amount.column,
                      },
              })
            }
          >
            <option value="signed">One column, signed</option>
            <option value="split">Money out and money in</option>
          </select>
        </label>
        {amount.kind === "signed" ? (
          <>
            {columnSelect("Amount", amount.column, (v) =>
              set({ amount: { ...amount, column: v ?? 0 } })
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={amount.negate}
                onChange={(e) => set({ amount: { ...amount, negate: e.target.checked } })}
              />
              Withdrawals are positive in this file
            </label>
          </>
        ) : (
          <>
            {columnSelect("Money out", amount.debit, (v) =>
              set({ amount: { ...amount, debit: v ?? 0 } })
            )}
            {columnSelect("Money in", amount.credit, (v) =>
              set({ amount: { ...amount, credit: v ?? 0 } })
            )}
          </>
        )}
        {columnSelect("Description", profile.description, (v) => set({ description: v ?? 0 }))}
        {columnSelect("Payee", profile.payee, (v) => set({ payee: v }), true)}
        {columnSelect("Bank transaction ID", profile.id, (v) => set({ id: v }), true)}
        {columnSelect("Running balance", profile.balance, (v) => set({ balance: v }), true)}
      </div>

      <h3 className="section-title">Preview</h3>
      <table className="preview-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line} className={r.error ? "bad" : undefined}>
              <td>{r.date ?? "?"}</td>
              <td>{r.error ? <span className="error">{r.error}</span> : r.description}</td>
              <td className="num">
                {r.amount ? formatMoney(shown(r.amount, type), currency) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        {readable} of the first {rows.length} rows read cleanly.{" "}
        {shownInverted(type)
          ? "Amounts are shown as the account reads: charges should increase what's owed (positive), payments decrease it."
          : "Money into the account should be positive, money out negative."}
      </p>

      <div className="actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || readable === 0}
          onClick={() => onSave(profile)}
        >
          Save and import
        </button>
      </div>
    </section>
  );
}
