/**
 * Stress sweeps: one geometry variable over a list of values. The in-browser ensemble screens
 * every point; a point the fallback policy rejects is solved with scikit-fem
 * (`fem_fallback`), and the student can confirm any screened point with FEM (`fem`). Each
 * point keeps its source, its ensemble disagreement and, when solved, the solver hotspot on
 * the same raster basis as the surrogate. See docs/CONTRACTS.md, Stress sweeps.
 */

import type { PredictionResponse } from "../../api/client";
import type { SurrogatePrediction } from "../../inference/engine";
import type { Case } from "../../physics/case";
import { fitsFrame } from "../../physics/encoding";
import { geometryIssues } from "../../physics/geometry";
import { candidateVariables } from "../../studio/OptimizePanel";

export const STRESS_SWEEP_SCHEMA = "physix.stress-sweep/1";
/** Points in one stress sweep; every fallback point costs a solve. */
export const MAX_STRESS_POINTS = 41;

export type StressSource = "surrogate" | "fem" | "fem_fallback";

/** Why a point left the surrogate: the model's reasons plus two of the sweep's own. */
export type StressFallbackReason =
  | "out_of_domain"
  | "high_disagreement"
  | "non_finite_prediction"
  | "outside_frame"
  | "model_unavailable";

export const FALLBACK_LABELS: Record<StressFallbackReason, string> = {
  out_of_domain: "outside the training domain",
  high_disagreement: "the ensemble members disagree",
  non_finite_prediction: "non-finite prediction",
  outside_frame: "taller than the model frame",
  model_unavailable: "the model is not loaded",
};

export const SOURCE_LABELS: Record<StressSource, string> = {
  surrogate: "Surrogate",
  fem: "FEM",
  fem_fallback: "FEM fallback",
};

export interface StressVariable {
  path: string;
  label: string;
  /** The current value, in metres. */
  value: number;
  /** A suggested range around it, in metres. */
  min: number;
  max: number;
}

export interface StressSweepSpec {
  variable: string;
  /** Values in metres, in sweep order. */
  values: number[];
}

export interface SurrogateScreen {
  /** Peak von Mises on the model grid, in Pa. */
  hotspot: number;
  x: number;
  y: number;
  disagreement: number;
  accepted: boolean;
  reason: StressFallbackReason | null;
  ms: number;
}

export interface FemResult {
  /** Peak von Mises in Pa, on the raster basis when the case fits the frame. */
  hotspot: number;
  x: number;
  y: number;
  basis: "raster" | "mesh";
  preset: string;
  nodes: number;
  ms: number;
}

export interface StressPoint {
  index: number;
  x: number;
  surrogate?: SurrogateScreen;
  fem?: FemResult;
  /** Where `value` came from; null when the point has none. */
  source: StressSource | null;
  /** The point's hotspot in Pa: the solver's when solved, else the surrogate's; NaN if none. */
  value: number;
  /** Why the point fell back, has no value, or failed. */
  note?: string;
  reason?: StressFallbackReason;
}

export interface StressSweepDeps {
  /** The in-browser ensemble, or null when it is not loaded. */
  predict: ((c: Case) => Promise<SurrogatePrediction>) | null;
  /** A forced FEM solve, or null when no solver is reachable. */
  solve: ((c: Case) => Promise<PredictionResponse>) | null;
}

/** The variables a stress sweep can vary: the same bounded set the optimizer searches. */
export function stressSweepVariables(c: Case): StressVariable[] {
  return candidateVariables(c);
}

const PATH =
  /^geometry\.(?:holes\[(\d+)\]\.(x|y|radius)|(web_width|flange_height|fillet_radius))$/;

/** The case with one geometry variable set; throws for a path the sweep does not offer. */
export function withValue(c: Case, path: string, value: number): Case {
  const match = PATH.exec(path);
  if (!match) throw new Error(`Unknown sweep variable ${path}.`);
  const [, hole, key, part] = match;
  if (hole !== undefined) {
    const i = Number(hole);
    if (i >= c.geometry.holes.length)
      throw new Error(`The part has no hole ${i + 1}.`);
    const holes = c.geometry.holes.map((h, k) =>
      k === i ? { ...h, [key]: value } : h,
    );
    return { ...c, geometry: { ...c.geometry, holes } };
  }
  return { ...c, geometry: { ...c.geometry, [part]: value } };
}

/** `count` evenly spaced values from `from` to `to`, both included. */
export function sweepValues(from: number, to: number, count: number): number[] {
  const n = Math.round(count);
  if (n === 1) return [from];
  return Array.from({ length: n }, (_, k) =>
    k === n - 1 ? to : from + ((to - from) * k) / (n - 1),
  );
}

/** A message when the spec cannot run on this case, else null. */
export function checkStressSpec(c: Case, spec: StressSweepSpec): string | null {
  if (!stressSweepVariables(c).some((v) => v.path === spec.variable))
    return "Choose a variable this part has.";
  if (!spec.values.length) return "Add at least one value.";
  if (spec.values.length > MAX_STRESS_POINTS)
    return `A stress sweep takes at most ${MAX_STRESS_POINTS} points.`;
  if (!spec.values.every((v) => Number.isFinite(v) && v >= 0))
    return "Values must be finite lengths.";
  return null;
}

/** The solver's hotspot on the surrogate's raster basis when it has one. */
export function femResult(resp: PredictionResponse): FemResult {
  const raster = resp.summary.raster_hotspot;
  const spot = raster ?? resp.summary.hotspot;
  return {
    hotspot: spot.von_mises,
    x: spot.x,
    y: spot.y,
    basis: raster ? "raster" : "mesh",
    preset: resp.solver?.mesh_preset ?? "",
    nodes: resp.solver?.nodes ?? 0,
    ms: resp.timing.total_ms,
  };
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

async function fallback(
  point: StressPoint,
  c: Case,
  reason: StressFallbackReason,
  solve: StressSweepDeps["solve"],
): Promise<StressPoint> {
  const why = FALLBACK_LABELS[reason];
  if (!solve)
    return {
      ...point,
      reason,
      source: null,
      value: Number.NaN,
      note: `Needs FEM (${why}), but the solver is offline.`,
    };
  try {
    const fem = femResult(await solve(c));
    return {
      ...point,
      reason,
      fem,
      source: "fem_fallback",
      value: fem.hotspot,
      note: `Solved with FEM: ${why}.`,
    };
  } catch (err) {
    return {
      ...point,
      reason,
      source: null,
      value: Number.NaN,
      note: `Needs FEM (${why}); the solve failed: ${message(err)}`,
    };
  }
}

/** Screen one point with the surrogate and fall back to FEM when the policy says so. */
export async function runStressPoint(
  base: Case,
  spec: StressSweepSpec,
  index: number,
  deps: StressSweepDeps,
): Promise<StressPoint> {
  const x = spec.values[index];
  const point: StressPoint = { index, x, source: null, value: Number.NaN };
  const c = withValue(base, spec.variable, x);
  const issues = geometryIssues(c);
  if (issues.length) return { ...point, note: issues[0].message };
  if (!deps.predict) return fallback(point, c, "model_unavailable", deps.solve);
  if (!fitsFrame(c)) return fallback(point, c, "outside_frame", deps.solve);
  let pred: SurrogatePrediction;
  try {
    pred = await deps.predict(c);
  } catch (err) {
    return { ...point, note: `The surrogate failed: ${message(err)}` };
  }
  const screened: StressPoint = {
    ...point,
    surrogate: {
      hotspot: pred.result.hotspot.von_mises,
      x: pred.result.hotspot.x,
      y: pred.result.hotspot.y,
      disagreement: pred.result.disagreement,
      accepted: pred.accepted,
      reason: pred.reason,
      ms: pred.timing.total_ms,
    },
  };
  if (pred.accepted)
    return {
      ...screened,
      source: "surrogate",
      value: pred.result.hotspot.von_mises,
    };
  return fallback(
    screened,
    c,
    pred.reason ?? "non_finite_prediction",
    deps.solve,
  );
}

/** Solve a screened point with FEM; its source becomes `fem` and the surrogate stays. */
export async function confirmStressPoint(
  base: Case,
  spec: StressSweepSpec,
  point: StressPoint,
  solve: NonNullable<StressSweepDeps["solve"]>,
): Promise<StressPoint> {
  if (point.fem) return point;
  const c = withValue(base, spec.variable, point.x);
  try {
    const fem = femResult(await solve(c));
    return { ...point, fem, source: "fem", value: fem.hotspot };
  } catch (err) {
    return { ...point, note: `The FEM check failed: ${message(err)}` };
  }
}

/**
 * Runs every point in order, one at a time, since both the ensemble and the solver worker
 * take one case at a time. Stops between points when `signal` aborts.
 */
export async function runStressSweep(
  base: Case,
  spec: StressSweepSpec,
  deps: StressSweepDeps,
  onPoint: (point: StressPoint) => void,
  signal?: AbortSignal,
): Promise<StressPoint[]> {
  const out: StressPoint[] = [];
  for (let index = 0; index < spec.values.length; index++) {
    if (signal?.aborted) break;
    const point = await runStressPoint(base, spec, index, deps);
    out.push(point);
    onPoint(point);
  }
  return out;
}

export interface StressSweepSummary {
  counts: Record<StressSource, number>;
  missing: number;
  /** Points solved with FEM that also have a surrogate screen. */
  compared: number;
  /** Largest |surrogate − FEM| / FEM over compared points, or null. */
  maxSurrogateError: number | null;
}

export function summarizeStressSweep(
  points: StressPoint[],
): StressSweepSummary {
  const counts: Record<StressSource, number> = {
    surrogate: 0,
    fem: 0,
    fem_fallback: 0,
  };
  let missing = 0;
  const errors: number[] = [];
  for (const point of points) {
    if (point.source) counts[point.source]++;
    else missing++;
    if (point.fem && point.surrogate && point.fem.basis === "raster")
      errors.push(
        Math.abs(point.surrogate.hotspot - point.fem.hotspot) /
          point.fem.hotspot,
      );
  }
  return {
    counts,
    missing,
    compared: errors.length,
    maxSurrogateError: errors.length ? Math.max(...errors) : null,
  };
}

export const STRESS_SWEEP_CSV_COLUMNS = [
  "point",
  "x",
  "x_unit",
  "source",
  "hotspot",
  "hotspot_x",
  "hotspot_y",
  "basis",
  "surrogate_hotspot",
  "disagreement",
  "fem_hotspot",
  "mesh_preset",
  "unit",
  "note",
] as const;

const cell = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? "" : String(value);
const quote = (text: string) =>
  /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** One row per point in SI units (metres and pascals); `#` lines carry the provenance. */
export function stressSweepCsv(
  base: Case,
  spec: StressSweepSpec,
  points: StressPoint[],
  meta: { modelId: string | null; threshold: number | null },
): string {
  const variable = stressSweepVariables(base).find(
    (v) => v.path === spec.variable,
  );
  const lines = [
    `# ${STRESS_SWEEP_SCHEMA}`,
    `# family: ${base.family}`,
    `# variable: ${spec.variable} (m)${variable ? `, ${variable.label}` : ""}`,
    `# points: ${points.length} of ${spec.values.length}`,
    `# model: ${meta.modelId ?? "none"}, disagreement threshold ${meta.threshold ?? "none"}`,
    "# hotspot: peak von Mises outside the support exclusion band; raster basis matches the surrogate grid",
    "# source: surrogate (accepted by the fallback policy), fem_fallback (rejected and solved), fem (confirmed by the student)",
    STRESS_SWEEP_CSV_COLUMNS.join(","),
  ];
  for (const point of points) {
    const spot = point.fem ?? point.surrogate;
    lines.push(
      [
        point.index,
        cell(point.x),
        "m",
        point.source ?? "",
        cell(point.value),
        cell(spot?.x),
        cell(spot?.y),
        point.fem ? point.fem.basis : point.surrogate ? "raster" : "",
        cell(point.surrogate?.hotspot),
        cell(point.surrogate?.disagreement),
        cell(point.fem?.hotspot),
        point.fem?.preset ?? "",
        "Pa",
        quote(point.note ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
