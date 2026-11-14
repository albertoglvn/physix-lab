/**
 * Stress line probes on the surrogate raster and on the FEM mesh.
 *
 * The mesh sampler mirrors `physics/probe.py`: each point takes the first triangle, in index
 * order, whose barycentric coordinates are all at least `-CONTAINMENT_TOL`, and points outside
 * every triangle are NaN. `tests/fixtures/line_probe_v1.json` pins the two together.
 */

import type { MeshPayload } from "../../api/client";
import { decodeFloat32, decodeInt32 } from "../../api/client";
import type { Case } from "../../physics/case";
import {
  COLS,
  pixelSize,
  PIXELS,
  ROWS,
  solidMask,
} from "../../physics/encoding";
import {
  distanceToSegment,
  loadSegment,
  signedDistance,
  supportSegment,
} from "../../physics/geometry";
import { vonMises } from "../../physics/stats";

export const CONTAINMENT_TOL = 1e-9;
export const PROBE_SAMPLES = 201;
/** Points used for a section resultant; one spacing bounds the error at each crossing. */
export const SECTION_SAMPLES = 1001;
export const PROBE_CSV_SCHEMA = "physix.probe/1";
export const PROBE_CSV_COLUMNS = [
  "source",
  "s_m",
  "x_m",
  "y_m",
  "sxx_pa",
  "syy_pa",
  "txy_pa",
  "von_mises_pa",
] as const;

export type Point = [number, number];
export interface ProbeLine {
  a: Point;
  b: Point;
}
export type ProbeSource = "surrogate" | "fem";

/** Stress `(σxx, σyy, τxy)` in Pa at a point, or null outside the solid. */
export type Sampler = (x: number, y: number) => [number, number, number] | null;

/** A profile along a line; values are NaN where the line leaves the solid. */
export interface ProbeProfile {
  source: ProbeSource;
  line: ProbeLine;
  s: number[];
  x: number[];
  y: number[];
  sxx: number[];
  syy: number[];
  txy: number[];
  vonMises: number[];
}

export type ProbeComponent = "sxx" | "syy" | "txy" | "vonMises";

export function lineLength({ a, b }: ProbeLine): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** `n` evenly spaced points from `a` to `b` inclusive. */
export function linePoints({ a, b }: ProbeLine, n: number): Point[] {
  if (n < 2) throw new Error("A line probe needs at least two points.");
  if (a[0] === b[0] && a[1] === b[1])
    throw new Error("A line probe needs two distinct end points.");
  const out: Point[] = [];
  for (let k = 0; k < n; k++) {
    // Matches numpy.linspace(0, 1, n) followed by a + t (b − a).
    const t = k === n - 1 ? 1 : k * (1 / (n - 1));
    out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return out;
}

/**
 * Bilinear interpolation between pixel centres of `channels` (each ROWS·COLS, row 0 at the
 * top). Only solid neighbours contribute and their weights are renormalised, so values next
 * to a hole are not pulled towards the zeros inside it.
 */
export function gridSampler(
  c: Case,
  channels: Float32Array[],
  mask: Uint8Array = solidMask(c),
): (x: number, y: number) => number[] | null {
  const dx = pixelSize(c);
  return (x, y) => {
    if (signedDistance(c, x, y) > 0) return null;
    const u = x / dx - 0.5;
    const v = ROWS - 0.5 - y / dx;
    const j0 = Math.floor(u);
    const i0 = Math.floor(v);
    const fu = u - j0;
    const fv = v - i0;
    const out = channels.map(() => 0);
    let total = 0;
    for (const [di, dj, w] of [
      [0, 0, (1 - fv) * (1 - fu)],
      [0, 1, (1 - fv) * fu],
      [1, 0, fv * (1 - fu)],
      [1, 1, fv * fu],
    ] as const) {
      const i = Math.min(ROWS - 1, Math.max(0, i0 + di));
      const j = Math.min(COLS - 1, Math.max(0, j0 + dj));
      const k = i * COLS + j;
      if (!mask[k] || w === 0) continue;
      total += w;
      channels.forEach((ch, n) => (out[n] += w * ch[k]));
    }
    if (total === 0) return nearestSolid(c, channels, mask, x, y);
    return out.map((value) => value / total);
  };
}

/** A solid point whose four neighbouring centres are all void reads the nearest solid pixel. */
function nearestSolid(
  c: Case,
  channels: Float32Array[],
  mask: Uint8Array,
  x: number,
  y: number,
): number[] | null {
  const dx = pixelSize(c);
  const j = Math.round(x / dx - 0.5);
  const i = Math.round(ROWS - 0.5 - y / dx);
  let best = -1;
  let bestD = Infinity;
  for (let di = -2; di <= 2; di++)
    for (let dj = -2; dj <= 2; dj++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= ROWS || jj >= COLS) continue;
      const k = ii * COLS + jj;
      const d = di * di + dj * dj;
      if (mask[k] && d < bestD) {
        bestD = d;
        best = k;
      }
    }
  return best < 0 ? null : channels.map((ch) => ch[best]);
}

/** Stress sampler on a `(3·PIXELS)` surrogate field in Pa. */
export function surrogateSampler(
  c: Case,
  stress: Float32Array,
  mask?: Uint8Array,
): Sampler {
  const sample = gridSampler(
    c,
    [0, 1, 2].map((n) => stress.subarray(n * PIXELS, (n + 1) * PIXELS)),
    mask,
  );
  return (x, y) => sample(x, y) as [number, number, number] | null;
}

/** The decoded element-vertex stress of an `include_mesh` payload. */
export interface MeshField {
  points: Float32Array; // (n, 2) m
  triangles: Int32Array; // (m, 3)
  stress: Float32Array; // (m, 3 vertices, 3 components) Pa
}

export function meshField(mesh: MeshPayload): MeshField | null {
  if (!mesh.stress) return null;
  const field = {
    points: decodeFloat32(mesh.points),
    triangles: decodeInt32(mesh.triangles),
    stress: decodeFloat32(mesh.stress),
  };
  if (field.stress.length !== field.triangles.length * 3)
    throw new Error("Mesh stress does not match the triangle count.");
  return field;
}

/** Exact element values; the same containment rule and arithmetic as `physics/probe.py`. */
export function meshSampler(field: MeshField): Sampler {
  const { points: p, triangles: t, stress } = field;
  const m = t.length / 3;
  const ax = new Float64Array(m);
  const ay = new Float64Array(m);
  const bx = new Float64Array(m);
  const by = new Float64Array(m);
  const cx = new Float64Array(m);
  const cy = new Float64Array(m);
  const det = new Float64Array(m);
  for (let e = 0; e < m; e++) {
    ax[e] = p[2 * t[3 * e]];
    ay[e] = p[2 * t[3 * e] + 1];
    bx[e] = p[2 * t[3 * e + 1]];
    by[e] = p[2 * t[3 * e + 1] + 1];
    cx[e] = p[2 * t[3 * e + 2]];
    cy[e] = p[2 * t[3 * e + 2] + 1];
    det[e] =
      (bx[e] - ax[e]) * (cy[e] - ay[e]) - (cx[e] - ax[e]) * (by[e] - ay[e]);
  }
  return (px, py) => {
    for (let e = 0; e < m; e++) {
      const l1 =
        ((px - ax[e]) * (cy[e] - ay[e]) - (cx[e] - ax[e]) * (py - ay[e])) /
        det[e];
      if (l1 < -CONTAINMENT_TOL) continue;
      const l2 =
        ((bx[e] - ax[e]) * (py - ay[e]) - (px - ax[e]) * (by[e] - ay[e])) /
        det[e];
      if (l2 < -CONTAINMENT_TOL) continue;
      const l0 = 1 - l1 - l2;
      if (l0 < -CONTAINMENT_TOL) continue;
      const v = 9 * e;
      return [0, 1, 2].map(
        (n) =>
          l0 * stress[v + n] + l1 * stress[v + 3 + n] + l2 * stress[v + 6 + n],
      ) as [number, number, number];
    }
    return null;
  };
}

export function probeProfile(
  sampler: Sampler,
  line: ProbeLine,
  source: ProbeSource,
  n = PROBE_SAMPLES,
): ProbeProfile {
  const out: ProbeProfile = {
    source,
    line,
    s: [],
    x: [],
    y: [],
    sxx: [],
    syy: [],
    txy: [],
    vonMises: [],
  };
  const [x0, y0] = line.a;
  for (const [x, y] of linePoints(line, n)) {
    const value = sampler(x, y);
    out.s.push(Math.hypot(x - x0, y - y0));
    out.x.push(x);
    out.y.push(y);
    const [sxx, syy, txy] = value ?? [NaN, NaN, NaN];
    out.sxx.push(sxx);
    out.syy.push(syy);
    out.txy.push(txy);
    out.vonMises.push(value ? vonMises(sxx, syy, txy) : NaN);
  }
  return out;
}

/** Unit normal of `a → b`, oriented towards the load edge's midpoint. */
export function sectionNormal(c: Case, { a, b }: ProbeLine): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  let n: Point = [dy / length, -dx / length];
  const seg = loadSegment(c);
  const mx = 0.5 * (seg.x0 + seg.x1) - a[0];
  const my = 0.5 * (seg.y0 + seg.y1) - a[1];
  if (n[0] * mx + n[1] * my < 0) n = [-n[0], -n[1]];
  return n;
}

/**
 * Force (N) carried across the profile's line: thickness × ∫ σ·n ds by the trapezoid rule,
 * counting only intervals with both ends in the solid. Use `SECTION_SAMPLES` points.
 */
export function sectionResultant(c: Case, profile: ProbeProfile): Point {
  const [nx, ny] = sectionNormal(c, profile.line);
  let fx = 0;
  let fy = 0;
  for (let k = 0; k + 1 < profile.s.length; k++) {
    const t0x = profile.sxx[k] * nx + profile.txy[k] * ny;
    const t1x = profile.sxx[k + 1] * nx + profile.txy[k + 1] * ny;
    if (!Number.isFinite(t0x) || !Number.isFinite(t1x)) continue;
    const t0y = profile.txy[k] * nx + profile.syy[k] * ny;
    const t1y = profile.txy[k + 1] * nx + profile.syy[k + 1] * ny;
    const ds = profile.s[k + 1] - profile.s[k];
    fx += 0.5 * (t0x + t1x) * ds;
    fy += 0.5 * (t0y + t1y) * ds;
  }
  return [c.thickness * fx, c.thickness * fy];
}

/**
 * Whether the line separates the support edge from the load edge, so that its resultant must
 * balance the applied force. The line is rasterised slightly thicker than a pixel diagonal
 * and a 4-connected flood fill from the support edge must not reach the load edge.
 */
export function isSectionCut(c: Case, line: ProbeLine): boolean {
  const dx = pixelSize(c);
  const mask = solidMask(c);
  const length = lineLength(line);
  if (length === 0) return false;
  const ux = (line.b[0] - line.a[0]) / length;
  const uy = (line.b[1] - line.a[1]) / length;
  const wall = {
    x0: line.a[0] - ux * dx,
    y0: line.a[1] - uy * dx,
    x1: line.b[0] + ux * dx,
    y1: line.b[1] + uy * dx,
    tag: "probe",
  };
  const support = supportSegment(c);
  const load = loadSegment(c);
  const open = new Uint8Array(PIXELS);
  const queue: number[] = [];
  const target = new Uint8Array(PIXELS);
  for (let i = 0; i < ROWS; i++)
    for (let j = 0; j < COLS; j++) {
      const k = i * COLS + j;
      const px = (j + 0.5) * dx;
      const py = (ROWS - i - 0.5) * dx;
      if (!mask[k] || distanceToSegment(wall, px, py) <= 0.71 * dx) continue;
      open[k] = 1;
      if (distanceToSegment(load, px, py) < dx) target[k] = 1;
      if (distanceToSegment(support, px, py) < dx) {
        queue.push(k);
        open[k] = 2;
      }
    }
  if (!queue.length) return true;
  while (queue.length) {
    const k = queue.pop() as number;
    if (target[k]) return false;
    const i = Math.floor(k / COLS);
    const j = k % COLS;
    for (const [ii, jj] of [
      [i - 1, j],
      [i + 1, j],
      [i, j - 1],
      [i, j + 1],
    ]) {
      if (ii < 0 || jj < 0 || ii >= ROWS || jj >= COLS) continue;
      const n = ii * COLS + jj;
      if (open[n] === 1) {
        open[n] = 2;
        queue.push(n);
      }
    }
  }
  return true;
}

export interface LinePreset {
  id: string;
  label: string;
  line: ProbeLine;
}

/** Sections a student usually checks first: net and gross sections, and the centreline. */
export function defaultLines(c: Case): LinePreset[] {
  const g = c.geometry;
  if (c.family === "plate") {
    const hole = g.holes[0];
    const x = hole ? hole.x : 0.5 * g.width;
    return [
      {
        id: "net",
        label: hole ? "Net section" : "Mid section",
        line: { a: [x, 0], b: [x, g.height] },
      },
      {
        id: "centreline",
        label: "Centreline",
        line: { a: [0, 0.5 * g.height], b: [g.width, 0.5 * g.height] },
      },
    ];
  }
  const a = g.web_width ?? 0;
  const b = g.flange_height ?? 0;
  const rf = g.fillet_radius ?? 0;
  const yWeb = 0.5 * (b + rf + g.height);
  const xFlange = 0.5 * (a + rf + g.width);
  return [
    { id: "web", label: "Web section", line: { a: [0, yWeb], b: [a, yWeb] } },
    {
      id: "flange",
      label: "Flange section",
      line: { a: [xFlange, 0], b: [xFlange, b] },
    },
  ];
}

const cell = (value: number) => (Number.isFinite(value) ? String(value) : "");

/** Long-form CSV of one or more profiles in SI units, with a commented header. */
export function probeCsv(
  profiles: ProbeProfile[],
  meta: string[] = [],
): string {
  const lines = [`# ${PROBE_CSV_SCHEMA}`, ...meta.map((m) => `# ${m}`)];
  for (const p of profiles)
    lines.push(
      `# ${p.source}: a = (${p.line.a.join(", ")}) m, b = (${p.line.b.join(", ")}) m, ${p.s.length} points; empty cells lie outside the solid`,
    );
  lines.push(PROBE_CSV_COLUMNS.join(","));
  for (const p of profiles)
    p.s.forEach((s, k) =>
      lines.push(
        [
          p.source,
          cell(s),
          cell(p.x[k]),
          cell(p.y[k]),
          cell(p.sxx[k]),
          cell(p.syy[k]),
          cell(p.txy[k]),
          cell(p.vonMises[k]),
        ].join(","),
      ),
    );
  return lines.join("\n") + "\n";
}
