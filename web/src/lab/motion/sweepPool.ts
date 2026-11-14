/**
 * Runs a sweep's points on a pool of runners: Web Workers in the browser, or in-process
 * runners in tests and on the command line. Points stream back as they finish and the sweep
 * can be cancelled; finished points are kept.
 */

import type { LabScene } from "../scene";
import { canonicalJson, ENGINE_NAME, sha256 } from "./run";
import {
  pointCount,
  readingsFor,
  runSweepPoint,
  sweepCoordinates,
  SWEEP_SCHEMA,
  type SweepPoint,
  type SweepSpec,
} from "./sweep";

export type SweepTask = { scene: LabScene; spec: SweepSpec; index: number };
/** A simulated point before readings are drawn, with the engine build that ran it. */
export type PointResult = Omit<SweepPoint, "readings"> & {
  engineVersion: string;
};

export type PointRunner = {
  run: (task: SweepTask) => Promise<PointResult>;
  dispose: () => void;
};

/** A `physix.sweep/1` record: the base scene, the design and every finished point. */
export type SweepRecord = {
  schema: typeof SWEEP_SCHEMA;
  /** sha256 of the scene and spec, so equal designs share an identity. */
  id: string;
  scene: LabScene;
  spec: SweepSpec;
  points: SweepPoint[];
  status: "complete" | "cancelled";
  /** The Rapier build that ran the points; empty when no point ran. */
  engine: { name: typeof ENGINE_NAME; version: string };
  timing: {
    wallMs: number;
    runners: number;
    /** Logical processors the browser reported, when it did. */
    hardwareConcurrency?: number;
    boundary: string;
  };
};

export const TIMING_BOUNDARY =
  "first dispatch to last point, including worker start-up and engine set-up in each worker";

export const sweepIdentity = (scene: LabScene, spec: SweepSpec) =>
  sha256(canonicalJson({ schema: SWEEP_SCHEMA, scene, spec }));

/** Leave a core for the page and cap the number of resident Rapier instances. */
export function poolSize(
  concurrency = globalThis.navigator?.hardwareConcurrency,
) {
  return Math.min(4, Math.max(1, (concurrency || 2) - 1));
}

/** Runs points in this thread. */
export const localRunner = (): PointRunner => ({
  run: ({ scene, spec, index }) => runSweepPoint(scene, spec, index),
  dispose: () => {},
});

type Reply = { id: number; point?: PointResult; error?: string };

/** Runs points in a dedicated module worker, one at a time. */
export function workerRunner(): PointRunner {
  const worker = new Worker(new URL("./sweep-worker.ts", import.meta.url), {
    type: "module",
  });
  let serial = 0;
  const pending = new Map<
    number,
    { resolve: (point: PointResult) => void; reject: (error: Error) => void }
  >();
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const { id, point, error } = event.data;
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    if (point) waiting.resolve(point);
    else waiting.reject(new Error(error ?? "The worker failed."));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    for (const waiting of pending.values())
      waiting.reject(new Error(event.message || "The sweep worker failed."));
    pending.clear();
  };
  return {
    run: (task) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, task });
      }),
    dispose: () => {
      worker.terminate();
      for (const waiting of pending.values())
        waiting.reject(new DOMException("Cancelled", "AbortError"));
      pending.clear();
    },
  };
}

export type SweepProgress = { done: number; total: number; point: SweepPoint };

/**
 * Runs every point of `spec` on `runners`, each taking the next unclaimed point. A point
 * whose run fails is kept with a NaN value and the error as its note.
 */
export async function runSweep(
  scene: LabScene,
  spec: SweepSpec,
  {
    runners,
    onPoint,
    signal,
    hardwareConcurrency = globalThis.navigator?.hardwareConcurrency,
  }: {
    runners: PointRunner[];
    onPoint?: (progress: SweepProgress) => void;
    signal?: AbortSignal;
    hardwareConcurrency?: number;
  },
): Promise<SweepRecord> {
  if (!runners.length) throw new Error("A sweep needs at least one runner.");
  const started = performance.now();
  const total = pointCount(spec);
  const points: SweepPoint[] = [];
  let next = 0;
  let version = "";
  const stop = () => runners.forEach((runner) => runner.dispose());
  signal?.addEventListener("abort", stop, { once: true });

  const work = async (runner: PointRunner) => {
    while (!signal?.aborted && next < total) {
      const index = next++;
      let result: PointResult;
      try {
        result = await runner.run({ scene, spec, index });
      } catch (error) {
        if (signal?.aborted) return;
        result = {
          index,
          ...sweepCoordinates(spec, index),
          value: Number.NaN,
          runId: "",
          stop: { reason: "time", t: 0 },
          wallMs: 0,
          note: error instanceof Error ? error.message : String(error),
          engineVersion: "",
        };
      }
      if (signal?.aborted) return;
      const { engineVersion, ...clean } = result;
      version ||= engineVersion;
      const point = {
        ...clean,
        readings: readingsFor(
          spec,
          index,
          result.value,
          result.perturbed?.values,
        ),
      };
      points.push(point);
      onPoint?.({ done: points.length, total, point });
    }
  };

  try {
    await Promise.all(runners.map(work));
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  points.sort((a, b) => a.index - b.index);
  return {
    schema: SWEEP_SCHEMA,
    id: await sweepIdentity(scene, spec),
    scene,
    spec,
    points,
    status: points.length === total ? "complete" : "cancelled",
    engine: { name: ENGINE_NAME, version },
    timing: {
      wallMs: performance.now() - started,
      runners: runners.length,
      ...(hardwareConcurrency ? { hardwareConcurrency } : {}),
      boundary: TIMING_BOUNDARY,
    },
  };
}
