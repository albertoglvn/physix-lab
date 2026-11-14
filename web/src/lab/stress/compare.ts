/**
 * Surrogate-versus-solver comparison on matched rasters. Errors are taken against the FEM
 * field on the same solid mask; model disagreement (member spread) is a separate quantity
 * and never enters these numbers.
 */

import type { ProbeComponent, ProbeProfile } from "./probe";

export interface FieldComparison {
  /** (surrogate − FEM) / FEM peak per pixel; 0 where either field is undefined. */
  diff: Float32Array;
  femPeak: number;
  /** Root-mean-square difference over masked pixels, Pa. */
  rmse: number;
  rmseRel: number;
  maxAbs: number;
  maxAbsRel: number;
  count: number;
}

export function compareFields(
  surrogate: Float32Array,
  fem: Float32Array,
  mask: Uint8Array,
): FieldComparison {
  if (surrogate.length !== fem.length || fem.length !== mask.length)
    throw new Error("Fields and mask must have the same length.");
  const both = (k: number) =>
    mask[k] && Number.isFinite(fem[k]) && Number.isFinite(surrogate[k]);
  let femPeak = 0;
  for (let k = 0; k < fem.length; k++)
    if (both(k)) femPeak = Math.max(femPeak, Math.abs(fem[k]));
  const scale = femPeak > 0 ? femPeak : 1;
  const diff = new Float32Array(fem.length);
  let sum = 0;
  let maxAbs = 0;
  let count = 0;
  for (let k = 0; k < fem.length; k++) {
    if (!both(k)) continue;
    const d = surrogate[k] - fem[k];
    diff[k] = d / scale;
    sum += d * d;
    maxAbs = Math.max(maxAbs, Math.abs(d));
    count++;
  }
  const rmse = count ? Math.sqrt(sum / count) : NaN;
  return {
    diff,
    femPeak,
    rmse,
    rmseRel: femPeak > 0 ? rmse / femPeak : NaN,
    maxAbs,
    maxAbsRel: femPeak > 0 ? maxAbs / femPeak : NaN,
    count,
  };
}

/** Signed relative error of `value` against `reference`, or null without a reference. */
export function relativeError(
  value: number | null | undefined,
  reference: number | null | undefined,
): number | null {
  if (value == null || reference == null || reference === 0) return null;
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return null;
  return (value - reference) / Math.abs(reference);
}

/** Yield strength over peak von Mises, or null when either is missing. */
export function safetyFactor(
  yieldStrength: number | null | undefined,
  peak: number | null | undefined,
): number | null {
  if (yieldStrength == null || peak == null) return null;
  if (!(yieldStrength > 0) || !(peak > 0)) return null;
  return yieldStrength / peak;
}

export interface ProfileDifference {
  rmse: number;
  maxAbs: number;
  count: number;
}

/** Pointwise difference of two profiles on the same line where both lie in the solid. */
export function profileDifference(
  a: ProbeProfile,
  b: ProbeProfile,
  component: ProbeComponent,
): ProfileDifference {
  if (a.s.length !== b.s.length)
    throw new Error("Profiles need the same number of points.");
  let sum = 0;
  let maxAbs = 0;
  let count = 0;
  a[component].forEach((value, k) => {
    const other = b[component][k];
    if (!Number.isFinite(value) || !Number.isFinite(other)) return;
    const d = value - other;
    sum += d * d;
    maxAbs = Math.max(maxAbs, Math.abs(d));
    count++;
  });
  return { rmse: count ? Math.sqrt(sum / count) : NaN, maxAbs, count };
}
