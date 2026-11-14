/** Display formatting. Values arrive in SI (m, Pa, N, ms); conversion happens only here. */

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Fixed-point with roughly `digits` significant figures. */
function sig(v: number, digits: number): string {
  const a = Math.abs(v);
  const whole = a >= 1 ? Math.floor(Math.log10(a)) + 1 : 1;
  return v.toFixed(Math.max(0, digits - whole));
}

/** Stress in MPa with three significant figures. */
export function mpa(pa: number | null | undefined, digits = 3): string {
  return finite(pa) ? `${sig(pa / 1e6, digits)} MPa` : "—";
}

export function gpa(pa: number | null | undefined): string {
  return finite(pa) ? `${sig(pa / 1e9, 3)} GPa` : "—";
}

/** Length in millimetres. */
export function mm(m: number | null | undefined, digits = 3): string {
  return finite(m) ? `${sig(m * 1e3, digits)} mm` : "—";
}

export function newtons(n: number | null | undefined): string {
  if (!finite(n)) return "—";
  return Math.abs(n) >= 1e3 ? `${sig(n / 1e3, 3)} kN` : `${sig(n, 3)} N`;
}

/** Duration given in milliseconds. */
export function ms(v: number | null | undefined): string {
  if (!finite(v)) return "—";
  if (v < 1) return `${(v * 1e3).toFixed(0)} µs`;
  if (v < 1000) return `${sig(v, 3)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export function pct(fraction: number | null | undefined, digits = 1): string {
  return finite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : "—";
}

export function ratio(v: number | null | undefined, digits = 2): string {
  return finite(v) ? `${v.toFixed(digits)}×` : "—";
}

export function plain(v: number | null | undefined, digits = 3): string {
  return finite(v) ? sig(v, digits) : "—";
}

/** Parse a user-entered number; NaN when it is not one. Accepts a decimal comma. */
export function parseNumber(text: string): number {
  const v = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(v) ? v : Number.NaN;
}
/** Manifest notes are lowercase fragments; show them as a sentence. */
export function asSentence(note: string) {
  const text = note.trim();
  if (!text) return "";
  const capital = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
