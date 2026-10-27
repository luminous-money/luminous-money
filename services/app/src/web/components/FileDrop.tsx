import { useState, type DragEvent } from "react";

/** A file to drop or tap to choose (a CSV, by default), saying which one's chosen. */
export function FileDrop({
  label,
  chosen,
  disabled = false,
  accept = ".csv,text/csv",
  onFile,
}: {
  /** The input's accessible name ("Chart of accounts file"). */
  label: string;
  /** The chosen file's name, if one is. */
  chosen?: string | null;
  disabled?: boolean;
  accept?: string;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };
  return (
    <label
      className={`dropzone${dragging ? " dragging" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        type="file"
        accept={accept}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <span>
        {chosen ? `${chosen} · choose another` : "Drop a CSV file here, or tap to choose one"}
      </span>
    </label>
  );
}
