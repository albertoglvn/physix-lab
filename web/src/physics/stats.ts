/**
 * Stress post-processing shared by the browser surrogate and solver fields; mirrors
 * `data/raster.py` (combine, von Mises, hotspot) and `model/ensemble.py`.
 */

import type { Case } from "./case";
import { traction } from "./case";
import { COLS, PIXELS, pixelSize, ROWS, supportBandMask } from "./encoding";

export interface Hotspot {
  von_mises: number;
  x: number;
  y: number;
  row: number;
  col: number;
}

/** Plane-stress von Mises: sqrt(sxx² − sxx·syy + syy² + 3·txy²). */
export function vonMises(sxx: number, syy: number, txy: number): number {
  return Math.sqrt(Math.max(sxx * sxx - sxx * syy + syy * syy + 3 * txy * txy, 0));
}

/** Physical stress (3·PIXELS, Pa) from unit-traction targets (6·PIXELS) at offset. */
export function combineTargets(targets: Float32Array, tx: number, ty: number, offset = 0): Float32Array {
  const out = new Float32Array(3 * PIXELS);
  for (let c = 0; c < 3; c++) {
    const a = offset + c * PIXELS;
    const b = offset + (c + 3) * PIXELS;
    for (let k = 0; k < PIXELS; k++) out[c * PIXELS + k] = tx * targets[a + k] + ty * targets[b + k];
  }
  return out;
}

export function vonMisesField(stress: Float32Array): Float32Array {
  const vm = new Float32Array(PIXELS);
  for (let k = 0; k < PIXELS; k++) vm[k] = vonMises(stress[k], stress[PIXELS + k], stress[2 * PIXELS + k]);
  return vm;
}

export function rasterHotspot(vm: Float32Array, mask: Uint8Array, c: Case, band?: Uint8Array): Hotspot {
  const b = band ?? supportBandMask(c);
  let best = -Infinity;
  let idx = -1;
  for (let k = 0; k < PIXELS; k++) {
    if (mask[k] && !b[k] && vm[k] > best) {
      best = vm[k];
      idx = k;
    }
  }
  if (idx < 0) {
    for (let k = 0; k < PIXELS; k++) {
      if (mask[k] && vm[k] > best) {
        best = vm[k];
        idx = k;
      }
    }
  }
  if (idx < 0) idx = 0;
  const i = Math.floor(idx / COLS);
  const j = idx % COLS;
  const dx = pixelSize(c);
  return { von_mises: vm[idx], x: (j + 0.5) * dx, y: (ROWS - i - 0.5) * dx, row: i, col: j };
}

export interface EnsembleResult {
  mean: Float32Array; // (3, R, C) Pa
  vonMises: Float32Array; // (R, C) Pa, von Mises of the mean field
  stdVonMises: Float32Array; // (R, C) Pa, member standard deviation of von Mises
  memberHotspots: number[];
  hotspot: Hotspot;
  disagreement: number;
  fieldSpread: number;
  maxVonMises: number;
}

/** `members`: K unit-traction outputs of length 6·PIXELS each. */
export function ensembleStatistics(members: Float32Array[], mask: Uint8Array, c: Case): EnsembleResult {
  const [tx, ty] = traction(c);
  const band = supportBandMask(c);
  const K = members.length;
  const phys = members.map((m) => combineTargets(m, tx, ty));
  const memberVm = phys.map(vonMisesField);
  const mean = new Float32Array(3 * PIXELS);
  for (const p of phys) for (let k = 0; k < mean.length; k++) mean[k] += p[k] / K;
  const vm = vonMisesField(mean);
  const hotspot = rasterHotspot(vm, mask, c, band);
  const memberHotspots = memberVm.map((v) => rasterHotspot(v, mask, c, band).von_mises);
  const mh = memberHotspots.reduce((a, b) => a + b, 0) / K;
  const sh = Math.sqrt(memberHotspots.reduce((a, b) => a + (b - mh) ** 2, 0) / K);
  const std = new Float32Array(PIXELS);
  let sumStd2 = 0;
  let sumVm2 = 0;
  let n = 0;
  let maxVm = 0;
  for (let k = 0; k < PIXELS; k++) {
    let m1 = 0;
    for (const v of memberVm) m1 += v[k] / K;
    let m2 = 0;
    for (const v of memberVm) m2 += (v[k] - m1) ** 2 / K;
    std[k] = Math.sqrt(m2);
    if (mask[k]) {
      sumStd2 += m2;
      sumVm2 += vm[k] * vm[k];
      n++;
      if (vm[k] > maxVm) maxVm = vm[k];
    }
  }
  const rmsMean = n ? Math.sqrt(sumVm2 / n) : 0;
  const spread = n ? Math.sqrt(sumStd2 / n) / Math.max(rmsMean, 1e-30) : 0;
  return {
    mean,
    vonMises: vm,
    stdVonMises: std,
    memberHotspots,
    hotspot,
    disagreement: sh / Math.max(mh, 1e-30),
    fieldSpread: spread,
    maxVonMises: maxVm,
  };
}
