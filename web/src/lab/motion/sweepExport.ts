/**
 * Sweep exports (LAB_PLAN.md §4.3): the stored fit, a tidy CSV, a methods paragraph and the
 * parser that restores a `physix.sweep/1` record from an experiment file.
 */

import { BASE_CONSTANTS } from "../data/expression";
import { BAND_COVERAGE, FIT_PRESETS, type FitModelId } from "../data/fit";
import { formatStep } from "../data/methods";
import { parseScene, type LabScene } from "../scene";
import {
  metricOption,
  parseSweepSpec,
  pointCount,
  runCount,
  sweepCoordinates,
  sweepVariables,
  SWEEP_SCHEMA,
  type SweepPoint,
} from "./sweep";
import type { SweepFit } from "./sweepFit";
import { TIMING_BOUNDARY, type SweepRecord } from "./sweepPool";
import { formatEstimate, parameterName } from "./SweepData";

/** A fit as stored in an experiment file: enough to report it and to repeat it. */
export type StoredFit = {
  model: FitModelId;
  expression: string;
  constants: Record<string, number>;
  /** "weighted" by the synthetic σ, or "unweighted" on the simulated values. */
  weighting: "weighted" | "unweighted";
  sigma?: number;
  parameters: { name: string; value: number; se: number }[];
  covariance: number[][];
  n: number;
  dof: number;
  r2: number;
  chi2?: number;
  reducedChi2?: number;
  converged: boolean;
  /** Coverage factor of the drawn band, in standard errors. */
  bandCoverage: number;
  /** Swept values left out of the fit, with the reason. */
  excluded?: { values: number[]; reason: string };
};

export function storedFit(fit: SweepFit): StoredFit {
  const { result, compiled } = fit;
  return {
    model: fit.model,
    expression: result.expression,
    constants: compiled.constants,
    weighting: fit.sigma === undefined ? "unweighted" : "weighted",
    ...(fit.sigma !== undefined ? { sigma: fit.sigma } : {}),
    parameters: result.parameters,
    covariance: result.covariance,
    n: result.n,
    dof: result.dof,
    r2: result.r2,
    ...(result.chi2 !== undefined
      ? { chi2: result.chi2, reducedChi2: result.reducedChi2 }
      : {}),
    converged: result.converged,
    bandCoverage: BAND_COVERAGE,
    ...(fit.excluded ? { excluded: fit.excluded } : {}),
  };
}

export const SWEEP_CSV_COLUMNS = [
  "point",
  "x",
  "x_unit",
  "x2",
  "x2_unit",
  "repeat",
  "input",
  "value",
  "unit",
  "source",
] as const;

const quote = (text: string) =>
  /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
const number = (value: number | undefined) =>
  value === undefined || Number.isNaN(value) ? "" : String(value);
const significant = (value: number, digits = 4) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : "—";

function describe(record: SweepRecord) {
  const { scene, spec } = record;
  const variables = sweepVariables(scene);
  const axis = (path: string, symbol: string) => {
    const variable = variables.find((item) => item.path === path);
    return {
      label: variable?.label ?? path,
      symbol: variable?.symbol ?? symbol,
      unit: variable?.unit ?? "",
    };
  };
  const metric = metricOption(scene, spec.metric);
  return {
    variable: axis(spec.variable, "x"),
    second: axis(spec.second?.variable ?? "", "x₂"),
    perturbed: axis(spec.perturbation?.variable ?? "", "u"),
    metric: {
      label: metric?.label ?? "metric",
      symbol: metric?.symbol ?? "y",
      unit: metric?.unit ?? "",
    },
  };
}

/**
 * One row per simulated value, synthetic reading and closed-form value, SI except angles in
 * degrees as the scene stores them; `#` lines carry the design, the noise and any
 * perturbation. `input` is a perturbed repeat's starting value, in the perturbed unit.
 */
export function sweepToCsv(record: SweepRecord, fit?: StoredFit): string {
  const { spec } = record;
  const { variable, second, perturbed, metric } = describe(record);
  const lines = [
    `# ${record.schema} ${record.id}`,
    `# scene: ${record.scene.name} (${record.scene.version})`,
    `# engine: ${record.engine.name} ${record.engine.version}`,
    `# time_step_s: ${spec.timeStep}`,
    `# variable: ${spec.variable} (${variable.unit || "1"})`,
  ];
  if (spec.second)
    lines.push(
      `# second_variable: ${spec.second.variable} (${second.unit || "1"}), grid ${spec.values.length} x ${spec.second.values.length}`,
    );
  lines.push(
    `# metric: ${metric.label} (${metric.unit || "1"})`,
    `# status: ${record.status}, ${record.points.length} of ${pointCount(spec)} points, ${runCount(spec)} runs planned`,
    spec.noise
      ? `# synthetic_noise: gaussian sigma ${spec.noise.sigma}, resolution ${spec.noise.resolution}, ${spec.repeats} readings per point, seed ${spec.seed}`
      : "# synthetic_noise: none",
    spec.perturbation
      ? `# perturbation: ${spec.perturbation.variable} (${perturbed.unit || "1"}) gaussian sigma ${spec.perturbation.sigma}, clamped to its limits, ${spec.repeats} runs per point, seed ${spec.seed}`
      : "# perturbation: none",
  );
  if (fit)
    lines.push(
      `# fit: ${fit.expression}; ${fit.parameters.map((item) => `${item.name} = ${item.value} ± ${item.se}`).join(", ")}; ${fit.weighting}`,
    );
  lines.push(SWEEP_CSV_COLUMNS.join(","));
  const row = (
    point: SweepPoint,
    repeat: number | undefined,
    value: number | undefined,
    source: string,
  ) =>
    [
      point.index,
      number(point.x),
      quote(variable.unit),
      number(point.x2),
      spec.second ? quote(second.unit) : "",
      repeat ?? "",
      repeat === undefined ? "" : number(point.perturbed?.inputs[repeat]),
      number(value),
      quote(metric.unit),
      source,
    ].join(",");
  for (const point of record.points) {
    lines.push(row(point, undefined, point.value, "simulated"));
    // With noise on, a perturbed run's clean metric is kept apart from its reading.
    if (spec.noise)
      point.perturbed?.values.forEach((value, repeat) =>
        lines.push(row(point, repeat, value, "perturbed")),
      );
    point.readings.forEach((reading, repeat) =>
      lines.push(row(point, repeat, reading, "synthetic")),
    );
    if (point.theory !== undefined)
      lines.push(row(point, undefined, point.theory, "theory"));
  }
  return lines.join("\n") + "\n";
}

/** The evenly spaced step of a value list, when it has one. */
function evenStep(values: number[]) {
  if (values.length < 2) return undefined;
  const step = values[1] - values[0];
  return values.every(
    (value, index) =>
      Math.abs(value - (values[0] + index * step)) <= 1e-9 * Math.abs(step),
  )
    ? Number(step.toPrecision(12))
    : undefined;
}

/** A methods paragraph for a sweep and its fit, to follow the run's own paragraph. */
export function sweepMethods(record: SweepRecord, fit?: StoredFit): string {
  const { spec } = record;
  const { variable, second, perturbed, metric } = describe(record);
  const unit = (text: string) => (text ? ` ${text}` : "");
  const range = (values: number[], units: string) => {
    const step = evenStep(values);
    return values.length === 1
      ? `at ${values[0]}${unit(units)}`
      : step !== undefined
        ? `from ${values[0]} to ${values[values.length - 1]}${unit(units)} in steps of ${step}${unit(units)} (${values.length} values)`
        : `over ${values.length} values from ${values[0]} to ${values[values.length - 1]}${unit(units)}`;
  };
  const total = pointCount(spec);
  const noun = spec.second ? "point" : "value";
  const failed = record.points.filter((point) => !Number.isFinite(point.value));
  const where = (point: SweepPoint) =>
    spec.second
      ? `${variable.symbol} = ${point.x}, ${second.symbol} = ${point.x2}`
      : `${variable.symbol} = ${point.x}`;
  const design = spec.second
    ? `${variable.label} ${range(spec.values, variable.unit)} and ${second.label} ${range(spec.second.values, second.unit)} on a ${spec.values.length} × ${spec.second.values.length} grid`
    : `${variable.label} ${range(spec.values, variable.unit)}`;
  const sentences = [
    `A sweep varied ${design}, reading ${metric.label.replace(/^./, (c) => c.toLowerCase())} from one run per ${noun} with ${record.engine.name} ${record.engine.version}, a ${formatStep(spec.timeStep)} step and the same stop protocol.`,
  ];
  if (record.status === "cancelled")
    sentences.push(
      `The sweep was cancelled after ${record.points.length} of ${total} ${noun}s.`,
    );
  if (failed.length)
    sentences.push(
      `${failed.length} ${failed.length === 1 ? `${noun} gave` : `${noun}s gave`} no result (${failed
        .map(where)
        .join("; ")}).`,
    );
  if (spec.perturbation)
    sentences.push(
      `Each ${noun} was also run ${spec.repeats} ${spec.repeats === 1 ? "time" : "times"} from ${perturbed.label} plus a Gaussian draw with σ = ${spec.perturbation.sigma}${unit(perturbed.unit)}, clamped to its limits, from seed ${spec.seed}; these synthetic perturbations are reported apart from the unperturbed run.`,
    );
  if (spec.noise)
    sentences.push(
      `Synthetic sensor noise, Gaussian with σ = ${spec.noise.sigma}${unit(metric.unit)}${spec.noise.resolution > 0 ? ` and rounded to ${spec.noise.resolution}${unit(metric.unit)}` : ""}, gave ${spec.repeats} ${spec.repeats === 1 ? "reading" : "readings"} per ${noun}${spec.perturbation ? ", one on each perturbed run," : ""} from seed ${spec.seed}; the simulated values are reported separately.`,
    );
  if (fit) {
    const parameters = fit.parameters
      .map(
        (item) =>
          `${parameterName(item.name)} = ${formatEstimate(item.value, item.se)}`,
      )
      .join(", ");
    const quality =
      fit.reducedChi2 !== undefined
        ? `χ²/dof = ${significant(fit.reducedChi2, 3)} with ${fit.dof} degrees of freedom`
        : `R² = ${fit.r2.toFixed(5)}`;
    const constants = Object.entries(fit.constants)
      .filter(([name]) => !Object.hasOwn(BASE_CONSTANTS, name))
      .map(([name, value]) => `${name} = ${value}`)
      .join(", ");
    sentences.push(
      `${fit.weighting === "weighted" ? `A weighted least-squares fit (σ = ${significant(fit.sigma!, 3)}${unit(metric.unit)} per reading)` : "An unweighted least-squares fit"} of ${metric.symbol} = ${fit.expression}${constants ? ` with ${constants}` : ""} to ${fit.n} ${fit.weighting === "weighted" ? "readings" : "values"} gave ${parameters} (± 1 standard error), ${quality}${fit.converged ? "" : "; the fit did not converge"}.`,
    );
    if (fit.excluded)
      sentences.push(
        `The fit left out ${variable.symbol} = ${fit.excluded.values.join(", ")}${unit(variable.unit)} (${fit.excluded.reason}).`,
      );
    sentences.push(
      `Bands show ± ${fit.bandCoverage} standard errors of the fitted curve.`,
    );
  }
  sentences.push(`Sweep ${record.id}.`);
  return sentences.join(" ");
}

/** Validates a stored fit: the model and expression it needs to be repeated. */
export function parseStoredFit(input: unknown): StoredFit {
  if (typeof input !== "object" || input === null)
    throw new Error("The sweep fit must be an object.");
  const fit = input as StoredFit;
  const models = new Set<string>([
    "custom",
    ...FIT_PRESETS.map((preset) => preset.id),
  ]);
  if (!models.has(fit.model))
    throw new Error(
      `The sweep fit has an unknown model "${String(fit.model)}".`,
    );
  if (typeof fit.expression !== "string" || !fit.expression.trim())
    throw new Error("The sweep fit has no expression.");
  if (!Array.isArray(fit.parameters))
    throw new Error("The sweep fit has no parameters.");
  return fit;
}

const finite = (value: unknown) =>
  typeof value === "number" ? value : Number.NaN;

/** Restores a stored sweep: its scene and spec are validated, JSON nulls read back as NaN. */
export function parseSweepRecord(input: unknown): SweepRecord {
  if (typeof input !== "object" || input === null)
    throw new Error("The sweep must be an object.");
  const raw = input as Record<string, unknown>;
  if (raw.schema !== SWEEP_SCHEMA)
    throw new Error(`The sweep must use ${SWEEP_SCHEMA}.`);
  const scene: LabScene = parseScene(raw.scene);
  const spec = parseSweepSpec(raw.spec, scene);
  if (!Array.isArray(raw.points)) throw new Error("The sweep has no points.");
  const points = raw.points.map((item: unknown, order): SweepPoint => {
    const point = item as Record<string, unknown>;
    const index = point?.index;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= pointCount(spec)
    )
      throw new Error(`Sweep point ${order + 1} has no valid index.`);
    const perturbed = point.perturbed as
      { inputs?: unknown; values?: unknown } | undefined;
    // x and x2 come from the index, and perturbed repeats only from a valid pair of lists.
    const rest = { ...(point as SweepPoint) };
    delete rest.x2;
    delete rest.perturbed;
    return {
      ...rest,
      ...sweepCoordinates(spec, index),
      value: finite(point.value),
      ...(point.theory === undefined ? {} : { theory: finite(point.theory) }),
      readings: Array.isArray(point.readings) ? point.readings.map(finite) : [],
      ...(spec.perturbation &&
      Array.isArray(perturbed?.inputs) &&
      Array.isArray(perturbed?.values)
        ? {
            perturbed: {
              inputs: perturbed.inputs.map(finite),
              values: perturbed.values.map(finite),
            },
          }
        : {}),
    };
  });
  const engine = (raw.engine ?? {}) as Partial<SweepRecord["engine"]>;
  const timing = (raw.timing ?? {}) as Partial<SweepRecord["timing"]>;
  return {
    schema: SWEEP_SCHEMA,
    id: String(raw.id ?? ""),
    scene,
    spec,
    points,
    status: raw.status === "cancelled" ? "cancelled" : "complete",
    engine: { name: "rapier3d-compat", version: String(engine.version ?? "") },
    timing: {
      wallMs: finite(timing.wallMs),
      runners: finite(timing.runners),
      ...(typeof timing.hardwareConcurrency === "number"
        ? { hardwareConcurrency: timing.hardwareConcurrency }
        : {}),
      boundary: String(timing.boundary ?? TIMING_BOUNDARY),
    },
  };
}
