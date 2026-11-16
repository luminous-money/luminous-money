/** A star: what's starred (an account, a fund, a budget) is on the user's home page. */
export function StarButton({
  starred,
  disabled,
  onToggle,
  label = "Starred",
}: {
  starred: boolean;
  disabled: boolean;
  onToggle: (starred: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`star${starred ? " on" : ""}`}
      aria-pressed={starred}
      aria-label={label}
      title={starred ? "Starred: on the home page" : "Star: show on the home page"}
      disabled={disabled}
      onClick={() => onToggle(!starred)}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
