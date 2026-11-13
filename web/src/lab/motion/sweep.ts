/**
 * Parameter sweeps over a Motion scene (LAB_PLAN.md §3.2). One scene variable takes a list
 * of values; each value is simulated once, because a run is deterministic, and one metric
 * is read from the run. Synthetic repeats add seeded sensor noise to that clean value on
 * the main thread, keyed by (seed, point, repeat), so they never depend on worker order.
 */

import { noiseProblem, noisyReading, type SensorNoise } from "../data/noise";
import { finiteMean, meanPeriod } from "../data/period";
import { MAX_SEED, stream } from "../data/random";
import {
  blockOnRamp,
  isBody,
  limits,
  oscillatorProblem,
  replaceObject,
  type LabObject,
  type LabScene,
} from "../scene";
import { MAX_TIME_STEP } from "../simulation";
import {
  parseProtocol,
  protocolFor,
  sceneQuantities,
  startingRamp,
  SYSTEM,
  type Protocol,
} from "./probes";
import { runProtocol, type MotionRun, type StopReason } from "./run";
import { referencesFor } from "./theory";

export const SWEEP_SCHEMA = "physix.sweep/1";
export const MAX_SWEEP_POINTS = 200;
export const MAX_REPEATS = 20;
/** Points × repeats; repeats cost no simulation, but every reading is stored. */
export const MAX_READINGS = 400;

export type SweepVariable = {
  /** `gravity`, `floorFriction` or `<object id>.<field>`. */
  path: string;
  label: string;
  symbol: string;
  /** The scene's own unit: degrees for angles, SI otherwise. */
  unit: string;
  min: number;
  max: number;
  /** Default value step, from the scene limits. */
  step: number;
};

export type ProbeStat = "final" | "max" | "min" | "mean" | "period";
export const PROBE_STATS: Record<ProbeStat, string> = {
  final: "Value at stop",
  max: "Maximum",
  min: "Minimum",
  mean: "Mean",
  period: "Period about the mean",
};

export type SweepMetric =
  | { kind: "reference"; id: string }
  | { kind: "probe"; key: string; stat: ProbeStat }
  | { kind: "stop_time" };

export type MetricOption = {
  metric: SweepMetric;
  label: string;
  symbol: string;
  unit: string;
};

export type SweepSpec = {
  variable: string;
  values: number[];
  metric: SweepMetric;
  /** Synthetic readings per point; 1 when noise is off. */
  repeats: number;
  seed: number;
  noise: SensorNoise | null;
  protocol: Protocol;
  timeStep: number;
};

export type SweepPoint = {
  index: number;
  x: number;
  /** The clean metric; NaN when the run does not define it. */
  value: number;
  /** The closed-form value at this x, for reference metrics. */
  theory?: number;
  /** Synthetic noisy readings, empty when noise is off. */
  readings: number[];
  runId: string;
  stop: { reason: StopReason; t: number };
  wallMs: number;
  /** Why the value is missing, or which assumption the scene breaks. */
  note?: string;
};

type Range = readonly [number, number, number];

const FIELDS: Record<
  LabObject["kind"],
  [field: string, label: string, symbol: string, unit: string, range: Range][]
> = {
  block: [
    ["mass", "mass", "m", "kg", limits.mass],
    ["size", "size", "s", "m", limits.size],
    ["y", "height", "h", "m", limits.height],
    ["vx", "launch speed", "vₓ", "m/s", limits.velocity],
    ["vy", "vertical launch speed", "v_y", "m/s", limits.velocity],
    ["restitution", "restitution", "e", "", limits.restitution],
    ["friction", "friction", "μ", "", limits.friction],
  ],
  ramp: [
    ["angle", "angle", "θ", "deg", limits.angle],
    ["friction", "friction", "μ", "", limits.friction],
    ["length", "length", "L", "m", limits.length],
  ],
  pulley: [
    ["leftMass", "left mass", "m₁", "kg", limits.mass],
    ["rightMass", "right mass", "m₂", "kg", limits.mass],
    ["wheelMass", "wheel mass", "M", "kg", limits.wheelMass],
  ],
  ball: [
    ["mass", "mass", "m", "kg", limits.mass],
    ["radius", "radius", "r", "m", limits.radius],
    ["y", "height", "h", "m", limits.height],
    ["vx", "launch speed", "vₓ", "m/s", limits.velocity],
    ["vy", "vertical launch speed", "v_y", "m/s", limits.velocity],
    ["restitution", "restitution", "e", "", limits.restitution],
    ["friction", "friction", "μ", "", limits.friction],
  ],
  cylinder: [
    ["mass", "mass", "m", "kg", limits.mass],
    ["radius", "radius", "r", "m", limits.radius],
    ["length", "length", "L", "m", limits.cylinderLength],
    ["y", "height", "h", "m", limits.height],
    ["vx", "launch speed", "vₓ", "m/s", limits.velocity],
    ["vy", "vertical launch speed", "v_y", "m/s", limits.velocity],
    ["restitution", "restitution", "e", "", limits.restitution],
    ["friction", "friction", "μ", "", limits.friction],
  ],
  pendulum: [
    ["length", "length", "L", "m", limits.pendulumLength],
    ["angle", "release angle", "θ₀", "deg", limits.swing],
    ["mass", "mass", "m", "kg", limits.mass],
    ["bobRadius", "bob radius", "r", "m", limits.bobRadius],
    ["pivotHeight", "pivot height", "H", "m", limits.pivotHeight],
  ],
  spring: [
    ["mass", "mass", "m", "kg", limits.mass],
    ["stiffness", "stiffness", "k", "N/m", limits.stiffness],
    ["damping", "damping", "c", "N·s/m", limits.damping],
    ["offset", "release offset", "u₀", "m", limits.offset],
    ["restLength", "rest length", "ℓ₀", "m", limits.restLength],
    ["anchorHeight", "anchor height", "H", "m", limits.pivotHeight],
  ],
};

const variable = (
  path: string,
  label: string,
  symbol: string,
  unit: string,
  [min, max, step]: Range,
): SweepVariable => ({ path, label, symbol, unit, min, max, step });

/** Variables a sweep can vary in this scene. Bodies on a ramp keep their ramp placement. */
export function sweepVariables(scene: LabScene): SweepVariable[] {
  const variables: SweepVariable[] = [
    variable("gravity", "Gravity", "g", "m/s²", limits.gravity),
    variable("floorFriction", "Floor friction", "μ", "", limits.friction),
  ];
  for (const part of scene.objects) {
    const onRamp = isBody(part) && startingRamp(part, scene);
    for (const [field, label, symbol, unit, range] of FIELDS[part.kind]) {
      if (onRamp && (field === "y" || field === "vx" || field === "vy"))
        continue;
      // A body without its own friction leaves the surface's coefficient in charge.
      if (isBody(part) && field === "friction" && part.friction === undefined)
        continue;
      variables.push(
        variable(
          `${part.id}.${field}`,
          `${part.id} ${label}`,
          symbol,
          unit,
          range,
        ),
      );
    }
  }
  return variables;
}

/** The current value of a variable in the scene. */
export function sweepValueOf(scene: LabScene, path: string): number {
  if (path === "gravity" || path === "floorFriction") return scene[path];
  const dot = path.lastIndexOf(".");
  const part = scene.objects.find((item) => item.id === path.slice(0, dot));
  const value = (part as Record<string, unknown> | undefined)?.[
    path.slice(dot + 1)
  ];
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * The scene with one variable set. Bodies on a changed ramp, or resized on one, stay on it;
 * a pendulum or spring that would reach the floor or its anchor is rejected.
 */
export function applySweepValue(
  scene: LabScene,
  path: string,
  value: number,
): LabScene {
  const known = sweepVariables(scene).find((item) => item.path === path);
  if (!known) throw new Error(`“${path}” is not a variable of this scene.`);
  if (!Number.isFinite(value) || value < known.min || value > known.max)
    throw new RangeError(
      `${known.label} must be between ${known.min} and ${known.max}${known.unit ? ` ${known.unit}` : ""}.`,
    );
  if (path === "gravity" || path === "floorFriction")
    return { ...scene, [path]: value };
  const dot = path.lastIndexOf(".");
  const part = scene.objects.find((item) => item.id === path.slice(0, dot))!;
  const next = { ...part, [path.slice(dot + 1)]: value } as LabObject;
  if (next.kind === "pendulum" || next.kind === "spring") {
    const problem = oscillatorProblem(next, scene.gravity);
    if (problem) throw new RangeError(problem);
  }
  if (isBody(next) && isBody(part)) {
    const start = startingRamp(part, scene);
    if (start)
      return replaceObject(
        scene,
        blockOnRamp(next, start.ramp, start.fraction, part.z - start.ramp.z),
      );
  }
  return replaceObject(scene, next);
}

/** Evenly spaced values from `from` to `to`, both included when the step lands on `to`. */
export function sweepValues(from: number, to: number, step: number): number[] {
  if (![from, to, step].every(Number.isFinite))
    throw new RangeError("From, to and step must be numbers.");
  if (from === to) return [from];
  if (step === 0 || Math.sign(step) !== Math.sign(to - from))
    throw new RangeError(
      "The step must move from the first value to the last.",
    );
  const count = Math.floor((to - from) / step + 1e-9) + 1;
  if (count > MAX_SWEEP_POINTS)
    throw new RangeError(
      `That is ${count} points; a sweep has at most ${MAX_SWEEP_POINTS}.`,
    );
  // Rounding to 12 significant digits keeps 0.1 steps from drifting to 0.30000000000000004.
  return Array.from({ length: count }, (_, index) =>
    Number((from + index * step).toPrecision(12)),
  );
}

/** Metrics a sweep can read from runs of this scene: references first, then probes. */
export function sweepMetrics(scene: LabScene): MetricOption[] {
  const options: MetricOption[] = referencesFor(scene).map((reference) => ({
    metric: { kind: "reference", id: reference.id },
    label: `${reference.label} (${reference.target})`,
    symbol: reference.symbol,
    unit: reference.unit,
  }));
  for (const quantity of sceneQuantities(scene))
    for (const stat of Object.keys(PROBE_STATS) as ProbeStat[])
      options.push({
        metric: { kind: "probe", key: quantity.key, stat },
        label: `${quantity.label} (${quantity.target}), ${PROBE_STATS[stat].toLowerCase()}`,
        symbol: quantity.symbol,
        unit: quantity.unit,
      });
  options.push({
    metric: { kind: "stop_time" },
    label: "Time to the stop event",
    symbol: "t",
    unit: "s",
  });
  return options;
}

export const metricKey = (metric: SweepMetric) =>
  metric.kind === "reference"
    ? `reference:${metric.id}`
    : metric.kind === "probe"
      ? `probe:${metric.key}:${metric.stat}`
      : "stop_time";

/** The part a metric reads, or the system for the stop time. */
export const metricTarget = (metric: SweepMetric) =>
  metric.kind === "stop_time"
    ? SYSTEM
    : (metric.kind === "reference" ? metric.id : metric.key).split(".")[0];

export const metricOption = (scene: LabScene, metric: SweepMetric) =>
  sweepMetrics(scene).find(
    (option) => metricKey(option.metric) === metricKey(metric),
  );

/** Reads a metric from a run of `scene`. */
export function measureMetric(
  run: MotionRun,
  metric: SweepMetric,
  scene: LabScene,
): { value: number; theory?: number; note?: string } {
  if (metric.kind === "stop_time")
    return run.stop.reason === "event"
      ? { value: run.stop.t }
      : { value: Number.NaN, note: "The run reached its time limit." };
  if (metric.kind === "reference") {
    const reference = referencesFor(scene).find(
      (item) => item.id === metric.id,
    );
    if (!reference)
      return {
        value: Number.NaN,
        note: "The reference does not apply at this value.",
      };
    const measured = reference.measure(run);
    return {
      value: measured ?? Number.NaN,
      theory: reference.value,
      note:
        measured === undefined
          ? "The run did not reach the reference's event."
          : reference.broken,
    };
  }
  const column = run.series.columns[metric.key];
  if (!column) return { value: Number.NaN, note: "No such probe." };
  const finite = column.filter(Number.isFinite);
  if (!finite.length) return { value: Number.NaN, note: "No finite samples." };
  if (metric.stat === "period") {
    const period = meanPeriod(run.series.t, column, finiteMean(column));
    return period === undefined
      ? { value: Number.NaN, note: "Fewer than two full cycles were recorded." }
      : { value: period };
  }
  const value =
    metric.stat === "final"
      ? column[column.length - 1]
      : metric.stat === "max"
        ? Math.max(...finite)
        : metric.stat === "min"
          ? Math.min(...finite)
          : finite.reduce((sum, item) => sum + item, 0) / finite.length;
  return { value };
}

/** Synthetic readings for one point: the same for a given seed, point and repeat. */
export function readingsFor(
  spec: Pick<SweepSpec, "noise" | "repeats" | "seed">,
  index: number,
  value: number,
): number[] {
  const { noise } = spec;
  if (!noise) return [];
  return Array.from({ length: spec.repeats }, (_, repeat) =>
    noisyReading(value, noise, stream(spec.seed, index, repeat)),
  );
}

/** Simulates one point of a sweep. Workers call this, as do tests in-process. */
export async function runSweepPoint(
  scene: LabScene,
  spec: SweepSpec,
  index: number,
): Promise<Omit<SweepPoint, "readings"> & { engineVersion: string }> {
  const x = spec.values[index];
  const varied = applySweepValue(scene, spec.variable, x);
  const run = await runProtocol(varied, protocolFor(varied, spec.protocol), {
    timeStep: spec.timeStep,
  });
  const measured = measureMetric(run, spec.metric, varied);
  return {
    index,
    x,
    value: measured.value,
    ...(measured.theory !== undefined ? { theory: measured.theory } : {}),
    runId: run.id,
    stop: { reason: run.stop.reason, t: run.stop.t },
    wallMs: run.timing.wallMs,
    ...(measured.note ? { note: measured.note } : {}),
    engineVersion: run.engine.version,
  };
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error(`${label} must be an object.`);
  return input as Record<string, unknown>;
}

function parseMetric(input: unknown, scene: LabScene): SweepMetric {
  const raw = record(input, "The sweep metric");
  let metric: SweepMetric;
  if (raw.kind === "reference" && typeof raw.id === "string")
    metric = { kind: "reference", id: raw.id };
  else if (
    raw.kind === "probe" &&
    typeof raw.key === "string" &&
    typeof raw.stat === "string" &&
    Object.hasOwn(PROBE_STATS, raw.stat)
  )
    metric = { kind: "probe", key: raw.key, stat: raw.stat as ProbeStat };
  else if (raw.kind === "stop_time") metric = { kind: "stop_time" };
  else throw new Error("The sweep metric is not recognised.");
  if (!metricOption(scene, metric))
    throw new Error("The sweep metric does not apply to this scene.");
  return metric;
}

/** Validates a sweep against the scene it varies. */
export function parseSweepSpec(input: unknown, scene: LabScene): SweepSpec {
  const raw = record(input, "The sweep");
  if (typeof raw.variable !== "string")
    throw new Error("Choose a variable to sweep.");
  if (
    !Array.isArray(raw.values) ||
    raw.values.length < 1 ||
    raw.values.length > MAX_SWEEP_POINTS ||
    !raw.values.every((value) => typeof value === "number")
  )
    throw new Error(`A sweep needs 1–${MAX_SWEEP_POINTS} numeric values.`);
  const values = raw.values as number[];
  values.forEach((value) =>
    applySweepValue(scene, raw.variable as string, value),
  );
  const metric = parseMetric(raw.metric, scene);
  let noise: SensorNoise | null = null;
  if (raw.noise !== null && raw.noise !== undefined) {
    const parsed = record(raw.noise, "Noise");
    noise = {
      sigma: Number(parsed.sigma),
      resolution: Number(parsed.resolution ?? 0),
    };
    const problem = noiseProblem(noise);
    if (problem) throw new Error(problem);
  }
  const repeats = raw.repeats ?? 1;
  if (
    typeof repeats !== "number" ||
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    repeats > MAX_REPEATS
  )
    throw new Error(`Repeats must be a whole number from 1 to ${MAX_REPEATS}.`);
  if (repeats > 1 && !noise)
    throw new Error(
      "Runs repeat exactly, so repeats need synthetic noise to differ.",
    );
  if (values.length * repeats > MAX_READINGS)
    throw new Error(
      `Points × repeats is ${values.length * repeats}; keep it at ${MAX_READINGS} or fewer.`,
    );
  const seed = raw.seed ?? 0;
  if (
    typeof seed !== "number" ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > MAX_SEED
  )
    throw new Error(`The seed must be a whole number from 0 to ${MAX_SEED}.`);
  const timeStep = raw.timeStep;
  if (
    typeof timeStep !== "number" ||
    !(timeStep > 0 && timeStep <= MAX_TIME_STEP)
  )
    throw new Error("The time step must be greater than 0 and at most 1/30 s.");
  return {
    variable: raw.variable,
    values,
    metric,
    repeats,
    seed,
    noise,
    protocol: parseProtocol(raw.protocol),
    timeStep,
  };
}

/** Points and noise flattened for fitting: one (x, y) per reading, or per clean value. */
export function fitData(points: SweepPoint[], noisy: boolean) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    if (noisy)
      for (const reading of point.readings) {
        xs.push(point.x);
        ys.push(reading);
      }
    else {
      xs.push(point.x);
      ys.push(point.value);
    }
  }
  return { xs, ys };
}
