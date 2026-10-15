import { useState } from "react";

/** A password input with "Show". `autoComplete` tells password managers what it's for:
 * `current-password` to log in, `new-password` to choose one. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label>
      {label}
      <span className="password-field">
        <input
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-label={label}
          required
        />
        <button
          type="button"
          className="link-button"
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}
