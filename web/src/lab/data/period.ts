/**
 * Periods of recorded oscillations, from level crossings interpolated between samples, and
 * the complete elliptic integral the exact pendulum period needs.
 */

/** Times at which `v` rises through `level`, linearly interpolated between samples. */
export function upwardCrossings(
  t: readonly number[],
  v: readonly number[],
  level: number,
): number[] {
  const times: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1];
    const b = v[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a < level && b >= level)
      times.push(t[i - 1] + ((level - a) / (b - a)) * (t[i] - t[i - 1]));
  }
  return times;
}

/**
 * Mean period between the first and last upward crossings of `level`, or undefined with
 * fewer than two. A damped oscillation crosses its equilibrium at the damped period.
 */
export function meanPeriod(
  t: readonly number[],
  v: readonly number[],
  level: number,
): number | undefined {
  const times = upwardCrossings(t, v, level);
  if (times.length < 2) return;
  return (times[times.length - 1] - times[0]) / (times.length - 1);
}

/** Mean of the finite values, the level a generic period statistic crosses. */
export function finiteMean(values: readonly number[]): number {
  let sum = 0;
  let n = 0;
  for (const value of values)
    if (Number.isFinite(value)) {
      sum += value;
      n++;
    }
  return n ? sum / n : Number.NaN;
}

/** Complete elliptic integral of the first kind K(k), by the arithmetic–geometric mean. */
export function ellipticK(k: number): number {
  if (!(Math.abs(k) < 1)) return Number.POSITIVE_INFINITY;
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 32 && Math.abs(a - b) > 1e-15 * a; i++)
    [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return Math.PI / (2 * a);
}
