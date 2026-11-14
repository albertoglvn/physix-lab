/**
 * Virtual-sensor noise. Readings are synthetic: a clean value plus a seeded Gaussian error,
 * then rounded to the sensor's resolution. Clean values are always kept beside them.
 */

import { gaussian, type Random } from "./random";

export type SensorNoise = {
  /** Standard deviation of the added error, in the metric's SI unit. */
  sigma: number;
  /** Reading step in the same unit; 0 keeps the full value. */
  resolution: number;
};

/** One reading of `value` through the sensor. */
export function noisyReading(
  value: number,
  noise: SensorNoise,
  random: Random,
): number {
  const reading = value + noise.sigma * gaussian(random);
  return noise.resolution > 0
    ? Math.round(reading / noise.resolution) * noise.resolution
    : reading;
}

/**
 * Standard uncertainty of one reading: the Gaussian error and the rounding error of a
 * uniform quantiser, resolution / √12, added in quadrature.
 */
export const readingUncertainty = (noise: SensorNoise) =>
  Math.hypot(noise.sigma, noise.resolution / Math.sqrt(12));

/** Returns an error message, or null when the noise is usable. */
export function noiseProblem(noise: SensorNoise): string | null {
  if (!Number.isFinite(noise.sigma) || noise.sigma < 0)
    return "Noise σ must be zero or positive.";
  if (!Number.isFinite(noise.resolution) || noise.resolution < 0)
    return "Resolution must be zero or positive.";
  if (noise.sigma === 0 && noise.resolution === 0)
    return "Set σ or a resolution, or turn noise off.";
  return null;
}
