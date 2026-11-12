/** Small form and display primitives used across pages. */

import { useState, type ReactNode } from "react";
import { parseNumber } from "./units";

/** Numeric input that edits an SI value in display units (`scale` = display / SI). */
export function NumField({
  label,
  value,
  onChange,
  scale = 1,
  unit,
  step,
  min,
  digits = 4,
  invalid,
  hint,
}: {
  label: string;
  value: number;
  onChange: (si: number) => void;
  scale?: number;
  unit?: string;
  step?: number;
  min?: number;
  digits?: number;
  invalid?: boolean;
  hint?: string;
}) {
  const shownValue = Number((value * scale).toPrecision(digits)).toString();
  const [text, setText] = useState(shownValue);
  const [focused, setFocused] = useState(false);
  return (
    <label className={`numfield ${invalid ? "is-invalid" : ""}`} title={hint}>
      <span className="numfield-label">{label}</span>
      <span className="numfield-box">
        <input
          inputMode="decimal"
          type="number"
          step={step}
          min={min}
          value={focused ? text : shownValue}
          onFocus={() => {
            setText(shownValue);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseNumber(e.target.value);
            if (Number.isFinite(v)) onChange(v / scale);
          }}
        />
        {unit && <span className="numfield-unit">{unit}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "is-on" : ""}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "accent";

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ""}`} title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="logo"
    >
      <defs>
        <linearGradient id="logo-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1f6fd1" />
          <stop offset="0.55" stopColor="#3cc0a0" />
          <stop offset="1" stopColor="#f2c14e" />
        </linearGradient>
      </defs>
      <rect x="2" y="7" width="28" height="18" rx="3" fill="url(#logo-g)" />
      <circle cx="16" cy="16" r="5" fill="var(--bg)" />
      <path d="M 2 7 L 2 25" stroke="var(--text)" strokeWidth="2" />
    </svg>
  );
}
