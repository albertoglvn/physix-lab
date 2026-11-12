/**
 * Feature encoding for the `physix.raster/1` contract; a line-by-line port of
 * `data/raster.py::encode_features`, checked against `tests/fixtures/encoding_v1.json`.
 *
 * Layout: float32 `(7, 64, 128)` row-major, row 0 at the top (maximum y). Pixel `(i, j)` has
 * its centre at `x = (j + 0.5)·dx`, `y = (ROWS − i − 0.5)·dx` with `dx = width / 128`.
 */

import type { Case } from "./case";
import {
  distanceToSegment,
  loadSegment,
  signedDistance,
  supportSegment,
} from "./geometry";

export const RASTER_SCHEMA = "physix.raster/1";
export const ROWS = 64;
export const COLS = 128;
export const PIXELS = ROWS * COLS;
export const FEATURE_CHANNELS = [
  "mask",
  "sdf",
  "x",
  "y",
  "support",
  "load",
  "poisson",
] as const;
export const TARGET_CHANNELS = [
  "sxx_x",
  "syy_x",
  "txy_x",
  "sxx_y",
  "syy_y",
  "txy_y",
] as const;
const PROXIMITY_LENGTH_REL = 0.1;
const SDF_SCALE = 10;

export const pixelSize = (c: Case): number => c.geometry.width / COLS;

export function fitsFrame(c: Case): boolean {
  return c.geometry.height <= ROWS * pixelSize(c) + 1e-12;
}

export function pixelCentre(c: Case, i: number, j: number): [number, number] {
  const dx = pixelSize(c);
  return [(j + 0.5) * dx, (ROWS - i - 0.5) * dx];
}

export function encodeFeatures(c: Case): Float32Array {
  const w = c.geometry.width;
  const dx = pixelSize(c);
  const lam = PROXIMITY_LENGTH_REL * w;
  const sup = supportSegment(c);
  const load = loadSegment(c);
  const nu = (c.material.poisson - 0.3) / 0.1;
  const out = new Float32Array(FEATURE_CHANNELS.length * PIXELS);
  for (let i = 0; i < ROWS; i++) {
    const py = (ROWS - i - 0.5) * dx;
    for (let j = 0; j < COLS; j++) {
      const px = (j + 0.5) * dx;
      const k = i * COLS + j;
      const sdf = signedDistance(c, px, py);
      out[k] = sdf < 0 ? 1 : 0;
      out[PIXELS + k] = Math.min(1, Math.max(-1, (SDF_SCALE * sdf) / w));
      out[2 * PIXELS + k] = px / w;
      out[3 * PIXELS + k] = (2 * py) / w;
      out[4 * PIXELS + k] = Math.exp(-distanceToSegment(sup, px, py) / lam);
      out[5 * PIXELS + k] = Math.exp(-distanceToSegment(load, px, py) / lam);
      out[6 * PIXELS + k] = nu;
    }
  }
  return out;
}

export function solidMask(c: Case): Uint8Array {
  const dx = pixelSize(c);
  const m = new Uint8Array(PIXELS);
  for (let i = 0; i < ROWS; i++) {
    const py = (ROWS - i - 0.5) * dx;
    for (let j = 0; j < COLS; j++)
      m[i * COLS + j] = signedDistance(c, (j + 0.5) * dx, py) < 0 ? 1 : 0;
  }
  return m;
}

/** Pixels closer than `bandRel · width` to the support edge (excluded from hotspots). */
export function supportBandMask(c: Case, bandRel = 0.05): Uint8Array {
  const dx = pixelSize(c);
  const seg = supportSegment(c);
  const lim = bandRel * c.geometry.width;
  const m = new Uint8Array(PIXELS);
  for (let i = 0; i < ROWS; i++) {
    const py = (ROWS - i - 0.5) * dx;
    for (let j = 0; j < COLS; j++)
      m[i * COLS + j] =
        distanceToSegment(seg, (j + 0.5) * dx, py) < lim ? 1 : 0;
  }
  return m;
}
