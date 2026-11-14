import { useId, useState, type KeyboardEvent } from "react";
import {
  formatQuantity,
  validateQuantity,
  type Dimension,
  type Limits,
} from "./quantity";
import "./ui.css";

export type UnitInputProps = Limits & {
  /** Noun shown above the field; the display unit is appended in parentheses. */
  label: string;
  dimension: Dimension;
  /** Current value in SI. */
  value: number;
  /** Display unit, for example `mm` or `deg`. Typed suffixes override it. */
  unit: string;
  digits?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
};

/**
 * A numeric field that shows an SI value in a display unit, accepts unit suffixes and
 * commits on Enter or blur. Escape restores the last committed value.
 */
export function UnitInput({
  label,
  dimension,
  value,
  unit,
  digits = 3,
  disabled,
  min,
  max,
  onCommit,
}: UnitInputProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? formatQuantity(value, dimension, unit, digits);

  const commit = () => {
    if (draft === null) return;
    const result = validateQuantity(draft, {
      label,
      dimension,
      unit,
      min,
      max,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setError(null);
    if (result.value !== value) onCommit(result.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape" && draft !== null) {
      event.preventDefault();
      setDraft(null);
      setError(null);
    }
  };

  return (
    <div className="px-field" data-invalid={error ? "" : undefined}>
      <label htmlFor={id}>
        {label}
        {unit ? <span className="px-field-unit"> ({unit})</span> : null}
      </label>
      <input
        id={id}
        className="px-input num"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={shown}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p id={`${id}-error`} className="px-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
