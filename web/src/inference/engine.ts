/**
 * In-browser ensemble inference with onnxruntime-web (WASM). Loads the versioned bundle in
 * `public/models` (manifest + K members), verifies each member's SHA-256 against the
 * manifest, and runs the exact graphs the Python service runs.
 */

import type * as Ort from "onnxruntime-web/wasm";
import ortGlue from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import type { Case } from "../physics/case";
import {
  checkDomain,
  decide,
  type Domain,
  type DomainCheck,
  type FallbackPolicy,
  type FallbackReason,
} from "../physics/domain";
import {
  COLS,
  encodeFeatures,
  FEATURE_CHANNELS,
  PIXELS,
  ROWS,
  solidMask,
  TARGET_CHANNELS,
} from "../physics/encoding";
import { ensembleStatistics, type EnsembleResult } from "../physics/stats";

export interface MemberMeta {
  member: number;
  seed: number;
  file: string;
  sha256: string;
  bytes: number;
  best_epoch?: number;
  parameters?: number;
}

export interface SplitSummary {
  cases: number;
  [metric: string]:
    | number
    | { mean: number; median: number; p90: number; max: number }
    | undefined;
}

export interface ModelManifest {
  schema: "physix.model/1";
  model_id: string;
  created_unix?: number;
  run_id?: string;
  dataset_id: string;
  architecture: Record<string, number | string>;
  training?: Record<string, unknown>;
  raster: {
    schema: string;
    rows: number;
    cols: number;
    feature_channels: string[];
    target_channels: string[];
  };
  domain: Domain;
  members: MemberMeta[];
  parity?: { max_rel_diff: number; tolerance: number };
  fallback_policy: FallbackPolicy;
  evaluation?: {
    reference: string;
    dataset_id: string;
    splits: Record<string, SplitSummary>;
    timing?: Record<string, unknown>;
    host?: Record<string, string>;
    metrics?: Record<string, string>;
    shifted_routing?: { cases: number; out_of_domain: number; note: string };
  };
}

export interface SurrogatePrediction {
  result: EnsembleResult;
  mask: Uint8Array;
  domain: DomainCheck;
  accepted: boolean;
  reason: FallbackReason;
  timing: {
    encode_ms: number;
    inference_ms: number;
    postprocess_ms: number;
    total_ms: number;
  };
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export class BundleError extends Error {}

export class Engine {
  private constructor(
    readonly manifest: ModelManifest,
    private readonly ort: typeof Ort,
    private readonly sessions: Ort.InferenceSession[],
    readonly threads: number,
    readonly loadMs: number,
  ) {}

  static async load(
    baseUrl = "models/",
    onProgress?: (done: number, total: number) => void,
  ): Promise<Engine> {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}manifest.json`, { cache: "no-cache" });
    if (!res.ok)
      throw new BundleError(
        `No model bundle at ${baseUrl} (HTTP ${res.status}).`,
      );
    const manifest = (await res.json()) as ModelManifest;
    if (manifest.schema !== "physix.model/1")
      throw new BundleError(`Unsupported bundle schema ${manifest.schema}.`);
    if (manifest.raster.rows !== ROWS || manifest.raster.cols !== COLS)
      throw new BundleError(
        "Bundle raster does not match the physix.raster/1 grid.",
      );
    if (
      manifest.raster.feature_channels.join() !== FEATURE_CHANNELS.join() ||
      manifest.raster.target_channels.join() !== TARGET_CHANNELS.join()
    )
      throw new BundleError("Bundle channels do not match this encoder.");

    const isolated =
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const threads = isolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1;
    // Loaded lazily to keep the first paint small.
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = threads;
    // Serve the Emscripten glue as a standalone file: thread workers import it
    // directly instead of re-importing the app bundle, which touches the DOM.
    const asset = (u: string) => new URL(u, document.baseURI).href;
    ort.env.wasm.wasmPaths = { mjs: asset(ortGlue), wasm: asset(ortWasm) };

    const sessions: Ort.InferenceSession[] = [];
    let done = 0;
    onProgress?.(0, manifest.members.length);
    for (const m of manifest.members) {
      const r = await fetch(`${baseUrl}${m.file}`);
      if (!r.ok) throw new BundleError(`Missing member ${m.file}.`);
      const bytes = await r.arrayBuffer();
      if ((await sha256Hex(bytes)) !== m.sha256)
        throw new BundleError(`Hash mismatch for ${m.file}; refusing to run.`);
      sessions.push(
        await ort.InferenceSession.create(new Uint8Array(bytes), {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        }),
      );
      onProgress?.(++done, manifest.members.length);
    }
    return new Engine(manifest, ort, sessions, threads, performance.now() - t0);
  }

  get modelId(): string {
    return this.manifest.model_id;
  }

  get policy(): FallbackPolicy {
    return this.manifest.fallback_policy;
  }

  async predict(c: Case): Promise<SurrogatePrediction> {
    const t0 = performance.now();
    const feats = encodeFeatures(c);
    const mask = solidMask(c);
    const t1 = performance.now();
    const input = new this.ort.Tensor("float32", feats, [
      1,
      FEATURE_CHANNELS.length,
      ROWS,
      COLS,
    ]);
    const members: Float32Array[] = [];
    for (const s of this.sessions) {
      const out = await s.run({ features: input });
      members.push(
        new Float32Array(
          (out.stress.data as Float32Array).subarray(
            0,
            TARGET_CHANNELS.length * PIXELS,
          ),
        ),
      );
    }
    const t2 = performance.now();
    const result = ensembleStatistics(members, mask, c);
    const domain = checkDomain(c, this.manifest.domain);
    const [accepted, reason] = decide(
      this.policy,
      result.disagreement,
      domain.in_domain,
    );
    const t3 = performance.now();
    return {
      result,
      mask,
      domain,
      accepted,
      reason,
      timing: {
        encode_ms: t1 - t0,
        inference_ms: t2 - t1,
        postprocess_ms: t3 - t2,
        total_ms: t3 - t0,
      },
    };
  }
}
