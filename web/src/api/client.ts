/** Typed client for the local Physix HTTP API (`mcp/physix_mcp/http_api.py`). */

import type { Case } from "../physics/case";
import type { DomainCheck } from "../physics/domain";
import { runBrowserFem } from "./browser-fem";

export const API_BASE: string =
  (import.meta.env.VITE_PHYSIX_API as string | undefined) ?? "";
export const BROWSER_FEM = import.meta.env.MODE === "sites" && !API_BASE;

export interface Frame {
  schema: string;
  rows: number;
  cols: number;
  dx: number;
  x0: number;
  y0: number;
  row_order: "top_to_bottom";
}

export interface FieldPayload {
  frame: Frame;
  components: string[];
  units: "Pa";
  encoding: "base64-float32-le";
  shape: [number, number, number];
  data: string;
}

export interface MeshPayload {
  points: string;
  triangles: string;
  von_mises: string;
  n_nodes: number;
  n_triangles: number;
}

export interface HotspotSummary {
  von_mises: number;
  x: number;
  y: number;
}

export interface Summary {
  max_von_mises: number;
  hotspot: HotspotSummary;
  hotspot_basis: "raster" | "mesh";
  stress_concentration: number | null;
  nominal_traction: number;
  applied_force: [number, number];
  yield_strength: number | null;
  safety_factor: number | null;
  volume: number;
  max_displacement?: number;
  reaction_force?: [number, number];
  equilibrium_residual?: number;
  raster_hotspot?: HotspotSummary & { row: number; col: number };
}

export interface PredictionResponse {
  schema: "physix.prediction/1";
  source: "surrogate" | "fem" | "fem_fallback";
  case_id: string;
  summary: Summary;
  uncertainty: {
    domain: DomainCheck;
    disagreement?: number;
    threshold?: number;
  };
  fallback: { used: boolean; reason: string | null };
  model?: { model_id: string };
  solver?: {
    name: string;
    version: string;
    mesh_preset: string;
    nodes: number;
    elements: number;
    element: string;
  };
  timing: {
    total_ms: number;
    stages: Record<string, number>;
    boundary: string;
    http_ms?: number;
  };
  field?: FieldPayload;
  mesh?: MeshPayload;
  label?: { status: string; case_id?: string } | null;
}

export interface SurrogateDiscrepancy {
  model_id: string;
  hotspot: HotspotSummary;
  hotspot_error: number;
  hotspot_location_error: number;
  hotspot_location_error_rel: number;
  component_rel_l2: number;
  von_mises_rel_l2: number;
  von_mises_mae_rel_peak: number;
  disagreement: number;
  would_fallback: boolean;
  surrogate_ms: number;
  fem_ms: number;
  speedup: number;
}

export interface VerifyResponse extends PredictionResponse {
  discrepancy: {
    prediction_hotspot_error?: number;
    prediction_hotspot_basis?: string;
    surrogate?: SurrogateDiscrepancy;
  };
  surrogate_field?: FieldPayload;
}

export interface OptimizeVariable {
  path: string;
  min: number;
  max: number;
}

export interface FemCheck {
  ok: boolean;
  error?: string;
  hotspot_von_mises: number;
  safety_factor: number | null;
  volume: number;
  objective: number;
  feasible: boolean;
  violations: string[];
  estimate_error: number;
  solve_ms: number;
}

export interface Design {
  variables: Record<string, number>;
  estimate: Record<string, number | string | boolean | null>;
  fem: FemCheck;
  case: Case;
}

export interface OptimizeResponse {
  schema: "physix.optimize/1";
  objective: string;
  constraints: Record<string, number>;
  baseline: Design;
  selected: Design | null;
  candidates_verified: Design[];
  improvement: {
    objective_baseline: number;
    objective_selected: number;
    relative_change: number;
  } | null;
  verified_improvement: boolean;
  feasible_found: boolean;
  search: {
    seed: number;
    budget: number;
    evaluations: number;
    estimators: Record<string, number>;
    method: string;
    trace: { stage: string; objective: number; feasible: boolean }[];
  };
  timing: { total_ms: number; http_ms?: number };
}

export interface ApiErrorBody {
  error: string;
  message: string;
  field?: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly field?: string | null,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (BROWSER_FEM && body !== undefined) {
    const payload = await runBrowserFem(path, body, signal);
    const error = payload as Partial<ApiErrorBody>;
    if (error.error)
      throw new ApiError(
        error.error,
        error.message ?? "FEM calculation failed.",
        0,
        error.field,
      );
    return payload as T;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(
      "offline",
      "The local Physix API is not reachable. Start it with `make serve`.",
      0,
    );
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError(
      "bad_response",
      `Unexpected response (HTTP ${res.status}).`,
      res.status,
    );
  }
  const p = payload as Partial<ApiErrorBody>;
  if (!res.ok || p.error) {
    throw new ApiError(
      p.error ?? "http_error",
      p.message ?? `HTTP ${res.status}`,
      res.status,
      p.field,
    );
  }
  return payload as T;
}

export const api = {
  health: (signal?: AbortSignal) =>
    request<{
      status: string;
      model_id: string | null;
      solver: { name: string; version: string; preset: string };
    }>("/api/health", undefined, signal),
  predict: (
    c: Case,
    opts: {
      include_field?: boolean;
      force_fem?: boolean;
      include_mesh?: boolean;
    } = {},
    signal?: AbortSignal,
  ) =>
    request<PredictionResponse>("/api/predict", { case: c, ...opts }, signal),
  verify: (
    c: Case,
    opts: {
      include_field?: boolean;
      include_mesh?: boolean;
      prediction?: unknown;
    } = {},
    signal?: AbortSignal,
  ) => request<VerifyResponse>("/api/verify", { case: c, ...opts }, signal),
  optimize: (
    body: {
      case: Case;
      variables: OptimizeVariable[];
      objective: string;
      constraints?: Record<string, number>;
      budget?: number;
      seed?: number;
    },
    signal?: AbortSignal,
  ) => request<OptimizeResponse>("/api/optimize", body, signal),
};

function b64bytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeFloat32(data: string): Float32Array {
  const bytes = b64bytes(data);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function decodeInt32(data: string): Int32Array {
  const bytes = b64bytes(data);
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/** Component `name` of a field payload as a `(rows·cols)` view. */
export function fieldComponent(
  field: FieldPayload,
  name: string,
): Float32Array {
  const k = field.components.indexOf(name);
  if (k < 0) throw new Error(`field has no component ${name}`);
  const [, rows, cols] = field.shape;
  const all = decodeFloat32(field.data);
  return all.subarray(k * rows * cols, (k + 1) * rows * cols);
}
