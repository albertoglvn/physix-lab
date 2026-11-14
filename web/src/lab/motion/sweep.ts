/**
 * Parameter sweeps over a Motion scene (LAB_PLAN.md §3.2). One scene variable takes a list
 * of values, or two variables take every pair on a grid; each point is simulated once,
 * because a run is deterministic, and one metric is read from the run. Repeats either add
 * seeded sensor noise to that clean value on the main thread, or rerun the point from a
 * seeded perturbation of one initial condition; both are keyed by (seed, point, repeat), so
 * they never depend on worker order.
 */

import { noiseProblem, noisyReading, type SensorNoise } from "../data/noise";
import { finiteMean, meanPeriod } from "../data/period";
import { gaussian, MAX_SEED, stream } from "../data/random";
import {
  blockOnRamp,
  dragCoefficientOf,
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
/** Values along one swept variable. */
export const MAX_SWEEP_POINTS = 200;
export const MAX_REPEATS = 20;
/** Points × repeats; noisy repeats cost no simulation, but every reading is stored. */
export const MAX_READINGS = 400;
/** Simulations in one sweep: grid points, plus one run per perturbed repeat. */
export const MAX_SWEEP_RUNS = 400;
/** Extra stream key that keeps perturbation draws apart from sensor-noise draws. */
export const PERTURBATION_KEY = 1;

export type SweepVariable = {
  /**
   * A scene field (`gravity`, `floorFriction`, `airDensity`, `linearDrag`),
   * `<object id>.<field>` or `<object id>.force.<x|y|start|end>`.
   */
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

/** A second swept variable: the sweep runs every pair of values on a grid. */
export type SweepAxis = { variable: string; values: number[] };

/** Gaussian draws added to one initial condition, one per repeat, clamped to its limits. */
export type Perturbation = { variable: string; sigma: number };

export type SweepSpec = {
  variable: string;
  values: number[];
  /** Absent for a one-variable sweep. */
  second?: SweepAxis;
  metric: SweepMetric;
  /** Synthetic readings per point; 1 when there is neither noise nor a perturbation. */
  repeats: number;
  seed: number;
  noise: SensorNoise | null;
  /** Absent when repeats start from the scene's own initial conditions. */
  perturbation?: Perturbation;
  protocol: Protocol;
  timeStep: number;
};

export type SweepPoint = {
  /** Row-major on a grid: first-variable index × second-axis length + second index. */
  index: number;
  x: number;
  /** The second variable's value on a grid. */
  x2?: number;
  /** The clean metric; NaN when the run does not define it. */
  value: number;
  /** The closed-form value at this x, for reference metrics. */
  theory?: number;
  /**
   * Synthetic readings, one per repeat: the perturbed runs' metrics when there is a
   * perturbation, with sensor noise added when there is noise; empty when there is neither.
   */
  readings: number[];
  /** The perturbed initial values, one per repeat, and the clean metric of each run. */
  perturbed?: { inputs: number[]; values: number[] };
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
    ["springStiffness", "spring stiffness", "k", "N/m", limits.pulleySpring],
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
  bumper: [
    ["stiffness", "stiffness", "k", "N/m", limits.stiffness],
    ["damping", "damping", "c", "N·s/m", limits.damping],
    ["restLength", "spring length", "L", "m", limits.restLength],
  ],
  pendulum: [
    ["length", "length", "L", "m", limits.pendulumLength],
    ["angle", "release angle", "θ₀", "deg", limits.swing],
    ["mass", "mass", "m", "kg", limits.mass],
    ["bobRadius", "bob radius", "r", "m", limits.bobRadius],
    ["pivotHeight", "pivot height", "H", "m", limits.pivotHeight],
    ["rodMass", "rod mass", "M", "kg", limits.rodMass],
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

const SCENE_FIELDS = [
  "gravity",
  "floorFriction",
  "airDensity",
  "linearDrag",
] as const;
type SceneField = (typeof SCENE_FIELDS)[number];
const isSceneField = (path: string): path is SceneField =>
  (SCENE_FIELDS as readonly string[]).includes(path);

const FORCE_FIELDS: [
  field: string,
  label: string,
  symbol: string,
  unit: string,
  range: Range,
][] = [
  ["x", "force x", "Fₓ", "N", limits.force],
  ["y", "force y", "F_y", "N", limits.force],
  ["start", "force start", "t₀", "s", limits.forceTime],
  ["end", "force end", "t₁", "s", limits.forceTime],
];

/** The object, field and, for a force, its component named by a sweep path. */
function locate(scene: LabScene, path: string) {
  const force = /^(.*)\.force\.(x|y|start|end)$/.exec(path);
  const dot = path.lastIndexOf(".");
  const id = force ? force[1] : path.slice(0, dot);
  return {
    part: scene.objects.find((item) => item.id === id),
    field: force ? "force" : path.slice(dot + 1),
    component: force?.[2] as "x" | "y" | "start" | "end" | undefined,
  };
}

/** Variables a sweep can vary in this scene. Bodies on a ramp keep their ramp placement. */
export function sweepVariables(scene: LabScene): SweepVariable[] {
  const variables: SweepVariable[] = [
    variable("gravity", "Gravity", "g", "m/s²", limits.gravity),
    variable("floorFriction", "Floor friction", "μ", "", limits.friction),
    variable("airDensity", "Air density", "ρ", "kg/m³", limits.airDensity),
    variable("linearDrag", "Linear drag", "b", "N·s/m", limits.linearDrag),
  ];
  for (const part of scene.objects) {
    const onRamp = isBody(part) && startingRamp(part, scene);
    if (isBody(part)) {
      // C_d matters only in air; a body without its own uses its shape's value.
      if (scene.airDensity > 0)
        variables.push(
          variable(
            `${part.id}.dragCoefficient`,
            `${part.id} drag coefficient`,
            "C_d",
            "",
            limits.dragCoefficient,
          ),
        );
      if (part.force)
        for (const [field, label, symbol, unit, range] of FORCE_FIELDS)
          variables.push(
            variable(
              `${part.id}.force.${field}`,
              `${part.id} ${label}`,
              symbol,
              unit,
              range,
            ),
          );
    }
    for (const [field, label, symbol, unit, range] of FIELDS[part.kind]) {
      if (onRamp && (field === "y" || field === "vx" || field === "vy"))
        continue;
      // A body without its own friction leaves the surface's coefficient in charge.
      if (isBody(part) && field === "friction" && part.friction === undefined)
        continue;
      // A rope has no mass to vary.
      if (
        part.kind === "pendulum" &&
        field === "rodMass" &&
        part.link === "rope"
      )
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

/** Fields that set where and how fast a part starts, not what it is. */
const INITIAL_CONDITIONS: Partial<Record<LabObject["kind"], string[]>> = {
  block: ["y", "vx", "vy"],
  ball: ["y", "vx", "vy"],
  cylinder: ["y", "vx", "vy"],
  pendulum: ["angle"],
  spring: ["offset"],
};

/** Initial conditions a sweep can perturb: heights, launch speeds, release angles, offsets. */
export function perturbationVariables(scene: LabScene): SweepVariable[] {
  return sweepVariables(scene).filter((item) => {
    if (isSceneField(item.path) || /\.force\./.test(item.path)) return false;
    const { part, field } = locate(scene, item.path);
    return !!part && !!INITIAL_CONDITIONS[part.kind]?.includes(field);
  });
}

/** Points in a sweep: the grid size, or the value count without a second variable. */
export const pointCount = (spec: Pick<SweepSpec, "values" | "second">) =>
  spec.values.length * (spec.second?.values.length ?? 1);

/** Simulations a sweep needs: every point, plus one per perturbed repeat. */
export const runCount = (
  spec: Pick<SweepSpec, "values" | "second" | "perturbation" | "repeats">,
) => pointCount(spec) * (1 + (spec.perturbation ? spec.repeats : 0));

/** The values a point takes, from its row-major index. */
export function sweepCoordinates(
  spec: Pick<SweepSpec, "values" | "second">,
  index: number,
): { x: number; x2?: number } {
  const columns = spec.second?.values.length ?? 1;
  const x = spec.values[Math.floor(index / columns)];
  return spec.second ? { x, x2: spec.second.values[index % columns] } : { x };
}

/** The current value of a variable in the scene. */
export function sweepValueOf(scene: LabScene, path: string): number {
  if (isSceneField(path)) return scene[path];
  const { part, field, component } = locate(scene, path);
  if (part && isBody(part)) {
    if (component) return part.force?.[component] ?? Number.NaN;
    if (field === "dragCoefficient") return dragCoefficientOf(part);
  }
  const value = (part as Record<string, unknown> | undefined)?.[field];
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
  if (isSceneField(path)) return { ...scene, [path]: value };
  const { part: found, field, component } = locate(scene, path);
  const part = found!;
  let next = { ...part, [field]: value } as LabObject;
  if (component && isBody(part) && part.force) {
    const force = { ...part.force, [component]: value };
    if (force.end <= force.start)
      throw new RangeError("A force must end after it starts.");
    next = { ...part, force };
  }
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

/**
 * Synthetic readings for one point: the same for a given seed, point and repeat. Without a
 * perturbation every repeat reads the clean value; with one, each repeat reads its own run.
 */
export function readingsFor(
  spec: Pick<SweepSpec, "noise" | "repeats" | "seed">,
  index: number,
  value: number,
  perturbed?: number[],
): number[] {
  const { noise } = spec;
  if (perturbed)
    return noise
      ? perturbed.map((reading, repeat) =>
          noisyReading(reading, noise, stream(spec.seed, index, repeat)),
        )
      : [...perturbed];
  if (!noise) return [];
  return Array.from({ length: spec.repeats }, (_, repeat) =>
    noisyReading(value, noise, stream(spec.seed, index, repeat)),
  );
}

/** One repeat's perturbed initial value: base + σ·N(0, 1), clamped to the variable's limits. */
export function perturbedInput(
  base: number,
  perturbation: Perturbation,
  range: { min: number; max: number },
  seed: number,
  index: number,
  repeat: number,
): number {
  const draw =
    base +
    perturbation.sigma *
      gaussian(stream(seed, index, repeat, PERTURBATION_KEY));
  return Math.min(range.max, Math.max(range.min, draw));
}

/** The scene at one point of the sweep, with both grid values applied. */
export function sceneAt(scene: LabScene, spec: SweepSpec, index: number) {
  const { x, x2 } = sweepCoordinates(spec, index);
  const varied = applySweepValue(scene, spec.variable, x);
  return spec.second
    ? applySweepValue(varied, spec.second.variable, x2!)
    : varied;
}

async function measuredRun(scene: LabScene, spec: SweepSpec) {
  const run = await runProtocol(scene, protocolFor(scene, spec.protocol), {
    timeStep: spec.timeStep,
  });
  return { run, measured: measureMetric(run, spec.metric, scene) };
}

/** Simulates one point of a sweep, and its perturbed repeats. Workers call this. */
export async function runSweepPoint(
  scene: LabScene,
  spec: SweepSpec,
  index: number,
): Promise<Omit<SweepPoint, "readings"> & { engineVersion: string }> {
  const { x, x2 } = sweepCoordinates(spec, index);
  const varied = sceneAt(scene, spec, index);
  const { run, measured } = await measuredRun(varied, spec);
  let perturbed: SweepPoint["perturbed"];
  if (spec.perturbation) {
    const { variable: path } = spec.perturbation;
    const range = sweepVariables(varied).find((item) => item.path === path);
    if (!range)
      throw new Error(`“${path}” is not an initial condition of this scene.`);
    const base = sweepValueOf(varied, path);
    perturbed = { inputs: [], values: [] };
    for (let repeat = 0; repeat < spec.repeats; repeat++) {
      const input = perturbedInput(
        base,
        spec.perturbation,
        range,
        spec.seed,
        index,
        repeat,
      );
      let value = Number.NaN;
      try {
        value = (await measuredRun(applySweepValue(varied, path, input), spec))
          .measured.value;
      } catch {
        // A start the scene rejects, such as a spring reaching its anchor, reads NaN.
      }
      perturbed.inputs.push(input);
      perturbed.values.push(value);
    }
  }
  return {
    index,
    x,
    ...(x2 !== undefined ? { x2 } : {}),
    value: measured.value,
    ...(measured.theory !== undefined ? { theory: measured.theory } : {}),
    runId: run.id,
    stop: { reason: run.stop.reason, t: run.stop.t },
    wallMs: run.timing.wallMs,
    ...(measured.note ? { note: measured.note } : {}),
    ...(perturbed ? { perturbed } : {}),
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

function parseValues(input: unknown, path: string, scene: LabScene) {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MAX_SWEEP_POINTS ||
    !input.every((value) => typeof value === "number")
  )
    throw new Error(`A sweep needs 1–${MAX_SWEEP_POINTS} numeric values.`);
  const values = input as number[];
  values.forEach((value) => applySweepValue(scene, path, value));
  return values;
}

/**
 * Validates a sweep against the scene it varies. Each axis is checked on its own; a pair the
 * scene rejects, such as a pendulum longer than its pivot is high, fails as that point.
 */
export function parseSweepSpec(input: unknown, scene: LabScene): SweepSpec {
  const raw = record(input, "The sweep");
  if (typeof raw.variable !== "string")
    throw new Error("Choose a variable to sweep.");
  const values = parseValues(raw.values, raw.variable, scene);
  let second: SweepAxis | undefined;
  if (raw.second !== null && raw.second !== undefined) {
    const axis = record(raw.second, "The second sweep variable");
    if (typeof axis.variable !== "string")
      throw new Error("Choose a second variable to sweep.");
    if (axis.variable === raw.variable)
      throw new Error("The second variable must differ from the first.");
    second = {
      variable: axis.variable,
      values: parseValues(axis.values, axis.variable, scene),
    };
    const points = pointCount({ values, second });
    if (points > MAX_SWEEP_RUNS)
      throw new Error(
        `A ${values.length} × ${second.values.length} grid is ${points} points; keep it at ${MAX_SWEEP_RUNS} or fewer.`,
      );
  }
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
  let perturbation: Perturbation | undefined;
  if (raw.perturbation !== null && raw.perturbation !== undefined) {
    const parsed = record(raw.perturbation, "The perturbation");
    const target = perturbationVariables(scene).find(
      (item) => item.path === parsed.variable,
    );
    if (!target)
      throw new Error(
        "Only a height, launch speed, release angle or release offset can be perturbed.",
      );
    const sigma = parsed.sigma;
    if (typeof sigma !== "number" || !(sigma > 0) || !Number.isFinite(sigma))
      throw new Error("The perturbation σ must be a positive number.");
    perturbation = { variable: target.path, sigma };
  }
  if (repeats > 1 && !noise && !perturbation)
    throw new Error(
      "Runs repeat exactly, so repeats need synthetic noise or a perturbed start to differ.",
    );
  const points = pointCount({ values, second });
  if (points * repeats > MAX_READINGS)
    throw new Error(
      `Points × repeats is ${points * repeats}; keep it at ${MAX_READINGS} or fewer.`,
    );
  const runs = runCount({ values, second, perturbation, repeats });
  if (runs > MAX_SWEEP_RUNS)
    throw new Error(
      `That is ${runs} runs, one per point and one per perturbed repeat; keep it at ${MAX_SWEEP_RUNS} or fewer.`,
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
  // Optional fields appear only when set, so one-variable sweeps keep their identity.
  return {
    variable: raw.variable,
    values,
    ...(second ? { second } : {}),
    metric,
    repeats,
    seed,
    noise,
    ...(perturbation ? { perturbation } : {}),
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
