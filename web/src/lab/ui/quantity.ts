/**
 * Quantities typed by the user. Values are stored in SI; a display unit is applied only when
 * a number is shown or parsed, following the AGENTS.md rule to convert at the edge.
 */

export type Dimension =
  | "length"
  | "mass"
  | "time"
  | "angle"
  | "force"
  | "stress"
  | "velocity"
  | "acceleration"
  | "stiffness"
  | "damping"
  | "ratio";

/** Factor from each unit to the SI base unit of its dimension. The first entry is the base. */
export const UNITS: Record<Dimension, Readonly<Record<string, number>>> = {
  length: { m: 1, cm: 1e-2, mm: 1e-3, km: 1e3 },
  mass: { kg: 1, g: 1e-3, t: 1e3 },
  time: { s: 1, ms: 1e-3, min: 60 },
  angle: { rad: 1, deg: Math.PI / 180, "°": Math.PI / 180 },
  force: { N: 1, kN: 1e3, MN: 1e6 },
  stress: { Pa: 1, kPa: 1e3, MPa: 1e6, GPa: 1e9 },
  velocity: { "m/s": 1, "km/h": 1 / 3.6 },
  acceleration: { "m/s²": 1, "m/s^2": 1, "m/s2": 1, g: 9.80665 },
  stiffness: { "N/m": 1, "kN/m": 1e3, "N/mm": 1e3 },
  damping: { "N·s/m": 1, "N s/m": 1, "Ns/m": 1, "kg/s": 1 },
  ratio: { "": 1, "%": 1e-2 },
};

const NOUN: Record<Dimension, string> = {
  length: "a length",
  mass: "a mass",
  time: "a time",
  angle: "an angle",
  force: "a force",
  stress: "a stress",
  velocity: "a speed",
  acceleration: "an acceleration",
  stiffness: "a stiffness",
  damping: "a damping coefficient",
  ratio: "a ratio",
};

export type ParseResult =
  { ok: true; value: number } | { ok: false; error: string };

const NUMBER =
  /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*(.*?)\s*$/i;

/** Finds `unit` in `dimension`, accepting a different letter case when it is unambiguous. */
export function unitFactor(
  dimension: Dimension,
  unit: string,
): number | undefined {
  const table = UNITS[dimension];
  if (unit in table) return table[unit];
  const matches = Object.keys(table).filter(
    (name) => name.toLowerCase() === unit.toLowerCase(),
  );
  return matches.length === 1 ? table[matches[0]] : undefined;
}

function dimensionOf(unit: string): Dimension | undefined {
  return (Object.keys(UNITS) as Dimension[]).find(
    (dimension) => unit !== "" && unit in UNITS[dimension],
  );
}

/**
 * Parses `text` such as `12`, `12 mm`, `1,5e3 Pa` or `30°` into SI. A bare number takes
 * `unit`, the unit the field displays.
 */
export function parseQuantity(
  text: string,
  dimension: Dimension,
  unit: string,
): ParseResult {
  const match = NUMBER.exec(text);
  if (!match)
    return { ok: false, error: `Enter a number in ${unit || "units"}.` };
  const number = Number(match[1].replace(",", "."));
  const suffix = match[2];
  const factor = unitFactor(dimension, suffix === "" ? unit : suffix);
  if (factor === undefined) {
    const other = dimensionOf(suffix);
    return {
      ok: false,
      error: other
        ? `${suffix} is ${NOUN[other]}; expected ${NOUN[dimension]}.`
        : `Unknown unit "${suffix}".`,
    };
  }
  const value = number * factor;
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, error: "Enter a finite number." };
}

/** SI value shown in `unit` with `digits` significant figures, without the unit. */
export function formatQuantity(
  value: number,
  dimension: Dimension,
  unit: string,
  digits = 3,
): string {
  const factor = unitFactor(dimension, unit);
  if (!Number.isFinite(value) || factor === undefined) return "";
  const shown = value / factor;
  if (shown === 0) return "0";
  const magnitude = Math.floor(Math.log10(Math.abs(shown)));
  const decimals = Math.min(12, Math.max(0, digits - 1 - magnitude));
  const rounded = Number(shown.toFixed(decimals));
  return Math.abs(magnitude) >= 6
    ? rounded.toExponential(digits - 1)
    : String(rounded);
}

export type Limits = { min?: number; max?: number };

/** Parses and checks limits; errors name the field, the limit and the unit (DESIGN.md §7). */
export function validateQuantity(
  text: string,
  field: { label: string; dimension: Dimension; unit: string } & Limits,
): ParseResult {
  const parsed = parseQuantity(text, field.dimension, field.unit);
  if (!parsed.ok) return parsed;
  const { min, max, label, dimension, unit } = field;
  const show = (v: number) =>
    `${formatQuantity(v, dimension, unit)}${unit ? ` ${unit}` : ""}`;
  const below = min !== undefined && parsed.value < min;
  const above = max !== undefined && parsed.value > max;
  if (below || above) {
    const error =
      min !== undefined && max !== undefined
        ? `${label} must be between ${formatQuantity(min, dimension, unit)} and ${show(max)}.`
        : below
          ? `${label} must be at least ${show(min!)}.`
          : `${label} must be at most ${show(max!)}.`;
    return { ok: false, error };
  }
  return parsed;
}
