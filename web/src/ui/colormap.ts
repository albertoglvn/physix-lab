/**
 * Colour maps shared by every field view, so the same stress always has the same colour.
 * Each map is a 256-entry RGB lookup table built from a few perceptually ordered stops.
 */

export type ColormapName = "stress" | "spread" | "diverging";

type Stop = [number, number, number, number]; // position, r, g, b

const STOPS: Record<ColormapName, Stop[]> = {
  // Dark blue -> teal -> yellow -> red: lightness rises up to yellow, then runs hot.
  stress: [
    [0.0, 13, 22, 66],
    [0.18, 31, 73, 145],
    [0.36, 26, 133, 160],
    [0.54, 70, 184, 128],
    [0.72, 222, 211, 73],
    [0.86, 244, 139, 46],
    [1.0, 205, 38, 44],
  ],
  // Black -> violet -> pink -> pale for model disagreement.
  spread: [
    [0.0, 16, 12, 34],
    [0.3, 74, 32, 120],
    [0.6, 182, 54, 132],
    [0.82, 247, 128, 108],
    [1.0, 252, 236, 190],
  ],
  // Blue -> near white -> red for signed errors.
  diverging: [
    [0.0, 33, 76, 166],
    [0.25, 105, 150, 214],
    [0.5, 238, 238, 238],
    [0.75, 228, 128, 104],
    [1.0, 170, 28, 40],
  ],
};

const LUTS = new Map<ColormapName, Uint8ClampedArray>();

export function lut(name: ColormapName): Uint8ClampedArray {
  const cached = LUTS.get(name);
  if (cached) return cached;
  const stops = STOPS[name];
  const out = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const t = k / 255;
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [p0, r0, g0, b0] = stops[s];
    const [p1, r1, g1, b1] = stops[s + 1];
    const f = Math.min(Math.max((t - p0) / (p1 - p0), 0), 1);
    out[3 * k] = r0 + f * (r1 - r0);
    out[3 * k + 1] = g0 + f * (g1 - g0);
    out[3 * k + 2] = b0 + f * (b1 - b0);
  }
  LUTS.set(name, out);
  return out;
}

/** CSS colour for a normalised value t in [0, 1]. */
export function colorAt(name: ColormapName, t: number): string {
  const table = lut(name);
  const k = Math.round(
    Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1) * 255,
  );
  return `rgb(${table[3 * k]}, ${table[3 * k + 1]}, ${table[3 * k + 2]})`;
}

export function gradientCss(name: ColormapName, direction = "to top"): string {
  const stops = Array.from(
    { length: 9 },
    (_, i) => `${colorAt(name, i / 8)} ${(i / 8) * 100}%`,
  );
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export interface Range {
  min: number;
  max: number;
}

/** Colour range over masked, finite values, optionally clipped at an upper quantile. */
export function fieldRange(
  values: ArrayLike<number>,
  mask?: ArrayLike<number> | null,
  upperQuantile = 1,
): Range {
  const vals: number[] = [];
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if ((!mask || mask[k]) && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return { min: 0, max: 1 };
  vals.sort((a, b) => a - b);
  const min = vals[0];
  const max =
    vals[
      Math.min(vals.length - 1, Math.floor(upperQuantile * (vals.length - 1)))
    ];
  return max > min ? { min, max } : { min, max: min + 1 };
}

/**
 * Paint a row-major field into RGBA pixels. Pixels outside the mask or with a non-finite
 * value stay transparent, which is how holes and the outside remain visibly empty.
 */
export function paint(
  values: ArrayLike<number>,
  mask: ArrayLike<number> | null,
  range: Range,
  name: ColormapName,
  out: Uint8ClampedArray,
): Uint8ClampedArray {
  const table = lut(name);
  const span = range.max - range.min || 1;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    const o = 4 * k;
    if ((mask && !mask[k]) || !Number.isFinite(v)) {
      out[o + 3] = 0;
      continue;
    }
    const idx = Math.round(
      Math.min(Math.max((v - range.min) / span, 0), 1) * 255,
    );
    out[o] = table[3 * idx];
    out[o + 1] = table[3 * idx + 1];
    out[o + 2] = table[3 * idx + 2];
    out[o + 3] = 255;
  }
  return out;
}
