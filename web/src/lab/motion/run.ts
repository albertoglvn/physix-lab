import { parseScene, type LabScene } from "../scene";
import { createSimulation, MAX_TIME_STEP, TIME_STEP } from "../simulation";
import {
  createRecorder,
  parseProtocol,
  PROBE_RATE,
  type Protocol,
  type Quantity,
  type RunEvent,
  type Series,
} from "./probes";

export const RUN_SCHEMA = "physix.run/1";
export const ENGINE_NAME = "rapier3d-compat";
/** Runs repeat exactly only on the same Rapier build and JavaScript engine (LAB_PLAN.md §4.1). */
export const REPRODUCIBILITY = "same build and browser engine";

export type RunInputs = {
  scene: LabScene;
  protocol: Protocol;
  timeStep: number;
  rate: number;
};

export type StopReason = "event" | "time";

/** A `physix.run/1` record: the inputs, engine, probe series and events of one Motion run. */
export type MotionRun = {
  schema: typeof RUN_SCHEMA;
  id: string;
  study: "motion";
  inputs: RunInputs;
  engine: {
    name: typeof ENGINE_NAME;
    version: string;
    solverIterations: number;
    reproducibility: typeof REPRODUCIBILITY;
  };
  seed: null;
  timing: { wallMs: number; boundary: string };
  quantities: Quantity[];
  series: Series;
  events: RunEvent[];
  stop: { reason: StopReason; t: number; event?: RunEvent };
};

/** JSON with sorted keys, so equal inputs always hash to the same identity. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    return item;
  });
}

export async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export const runIdentity = (inputs: RunInputs) =>
  sha256(canonicalJson({ schema: RUN_SCHEMA, ...inputs }));

/**
 * Runs a scene headlessly until the protocol's stop event or time limit. The browser and
 * the command line both use this, so a run file reproduces the same trial.
 */
export async function runProtocol(
  input: unknown,
  protocolInput: unknown,
  {
    timeStep = TIME_STEP,
    rate = PROBE_RATE,
    signal,
  }: {
    timeStep?: number;
    rate?: number;
    /** Browser callers can cancel a stale preview and yield to input between batches. */
    signal?: AbortSignal;
  } = {},
): Promise<MotionRun> {
  signal?.throwIfAborted();
  const scene = parseScene(input);
  const protocol = parseProtocol(protocolInput);
  if (!(timeStep > 0 && timeStep <= MAX_TIME_STEP))
    throw new RangeError(
      "The time step must be greater than 0 and at most 1/30 s.",
    );
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1 / timeStep)
    throw new RangeError(
      "The probe rate must be positive and at most one sample per step.",
    );
  const inputs: RunInputs = { scene, protocol, timeStep, rate };
  const started = performance.now();
  const simulation = await createSimulation(scene, { timeStep });
  try {
    signal?.throwIfAborted();
    const recorder = createRecorder(scene, simulation, rate);
    const limit = Math.round(protocol.maxTime / timeStep);
    let stop: MotionRun["stop"] | undefined;
    let nextYield = performance.now() + 8;
    for (let tick = 0; tick < limit && !stop; tick++) {
      simulation.step();
      const event = recorder
        .afterStep()
        .find((raised) => raised.type === protocol.stop);
      if (event) stop = { reason: "event", t: event.t, event };
      if (signal && tick % 16 === 15 && performance.now() >= nextYield) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
        nextYield = performance.now() + 8;
      }
    }
    stop ??= { reason: "time", t: simulation.time };
    recorder.sample();
    const wallMs = performance.now() - started;
    return {
      schema: RUN_SCHEMA,
      id: await runIdentity(inputs),
      study: "motion",
      inputs,
      engine: {
        name: ENGINE_NAME,
        version: simulation.rapierVersion,
        solverIterations: simulation.solverIterations,
        reproducibility: REPRODUCIBILITY,
      },
      seed: null,
      timing: {
        wallMs,
        boundary: signal
          ? "engine set-up, steps and probe sampling, including time yielded to the browser"
          : "engine set-up, every step and probe sampling; excludes rendering",
      },
      quantities: recorder.quantities,
      series: recorder.series,
      events: recorder.events,
      stop,
    };
  } finally {
    simulation.dispose();
  }
}

/** The value of a column at time t, interpolated linearly between samples. */
export function valueAt(run: MotionRun, key: string, t: number): number {
  const column = run.series.columns[key];
  const times = run.series.t;
  if (!column || !times.length) return Number.NaN;
  if (t <= times[0]) return column[0];
  for (let index = 1; index < times.length; index++) {
    if (times[index] >= t) {
      const t0 = times[index - 1];
      const share = (t - t0) / (times[index] - t0);
      return column[index - 1] + share * (column[index] - column[index - 1]);
    }
  }
  return column[column.length - 1];
}

export const eventOf = (
  run: MotionRun,
  type: RunEvent["type"],
  target: string,
) => run.events.find((event) => event.type === type && event.target === target);

/**
 * A re-run matches within tolerance when every sample differs by at most this share of
 * max(1, |stored value|): rounding-level drift, far below any probe's resolution.
 */
export const REPRODUCE_TOLERANCE = 1e-9;

export type Reproduction = {
  run: MotionRun;
  sameIdentity: boolean;
  sameShape: boolean;
  identical: boolean;
  /** Largest absolute difference over every sample of every column. */
  largestDifference: number;
  /** Largest difference as a share of max(1, |stored value|). */
  relativeDifference: number;
  verdict: "identical" | "within" | "different";
  sameEngine: boolean;
};

/** Compares a re-run with a stored run: bit for bit, within tolerance, or different. */
export async function reproduce(run: MotionRun): Promise<Reproduction> {
  const again = await runProtocol(run.inputs.scene, run.inputs.protocol, {
    timeStep: run.inputs.timeStep,
    rate: run.inputs.rate,
  });
  let largest = 0;
  let relative = 0;
  const keys = Object.keys(run.series.columns);
  const sameShape =
    again.series.t.length === run.series.t.length &&
    keys.every((key) => key in again.series.columns);
  if (sameShape)
    for (const key of ["t", ...keys]) {
      const a = key === "t" ? run.series.t : run.series.columns[key];
      const b = key === "t" ? again.series.t : again.series.columns[key];
      for (let index = 0; index < a.length; index++) {
        if (Object.is(a[index], b[index])) continue;
        if (Number.isNaN(a[index]) && Number.isNaN(b[index])) continue;
        const difference = Math.abs(a[index] - b[index]);
        // A sample missing in only one run, or an infinity, counts as a full mismatch.
        const gap = Number.isFinite(difference)
          ? difference
          : Number.POSITIVE_INFINITY;
        largest = Math.max(largest, gap);
        relative = Math.max(relative, gap / Math.max(1, Math.abs(a[index])));
      }
    }
  const identical = sameShape && largest === 0;
  return {
    run: again,
    sameIdentity: again.id === run.id,
    sameShape,
    identical,
    largestDifference: sameShape ? largest : Number.POSITIVE_INFINITY,
    relativeDifference: sameShape ? relative : Number.POSITIVE_INFINITY,
    verdict: identical
      ? "identical"
      : sameShape && relative <= REPRODUCE_TOLERANCE
        ? "within"
        : "different",
    sameEngine: again.engine.version === run.engine.version,
  };
}

/** A one-line report of a reproduction, with a toast tone. */
export function reproductionMessage(
  outcome: Reproduction,
  stored: MotionRun,
): { tone: "ok" | "warn"; message: string } {
  const engine = outcome.sameEngine
    ? ""
    : ` It was recorded with Rapier ${stored.engine.version}; this lab uses ${outcome.run.engine.version}.`;
  if (outcome.verdict === "identical")
    return {
      tone: "ok",
      message: `The re-run matches the stored run bit for bit.${engine}`,
    };
  if (outcome.verdict === "within")
    return {
      tone: "ok",
      message: `The re-run matches within tolerance: samples differ by up to ${outcome.largestDifference.toPrecision(3)}, ${outcome.relativeDifference.toPrecision(2)} relative.${engine}`,
    };
  return {
    tone: "warn",
    message: outcome.sameShape
      ? `The re-run differs from the stored run by up to ${outcome.largestDifference.toPrecision(3)}.${engine}`
      : `The re-run recorded ${outcome.run.series.t.length} samples where the stored run has ${stored.series.t.length}.${engine}`,
  };
}
