/**
 * Fitting a sweep: which data enter the fit, which constants the expression may use, and
 * which fitted parameters the scene itself configures, so the fit can be checked against them.
 */

import type { CompiledExpression } from "../data/expression";
import {
  BAND_COVERAGE,
  bandAt,
  fitExpression,
  presetById,
  type FitModelId,
  type FitResult,
} from "../data/fit";
import { readingUncertainty } from "../data/noise";
import type { ScatterFit } from "../data/SweepPlot";
import { isBody, type LabScene } from "../scene";
import { startingRamp } from "./probes";
import { fitData, type SweepPoint, type SweepSpec } from "./sweep";

export type KnownParameter = { value: number; source: string };

export type SweepFit = {
  model: FitModelId;
  result: FitResult;
  compiled: CompiledExpression;
  /** Standard uncertainty given to each reading, when the fit used synthetic noise. */
  sigma?: number;
  curve: ScatterFit;
  /** Fitted parameters the scene sets directly, by parameter name. */
  known: Record<string, KnownParameter>;
  /** Swept values left out of the fit, with the reason. */
  excluded: { values: number[]; reason: string } | null;
};

/** Below this clean acceleration (m/s²) the block is taken to be at rest. */
export const RESTING_ACCELERATION = 1e-3;

/**
 * The incline law g(sin θ − μ cos θ) holds only while the block slides. At or below the
 * sliding angle the block rests and reads zero, so those values are left out of that fit.
 */
function fitPoints(model: FitModelId, points: SweepPoint[]) {
  if (model !== "incline") return { kept: points, excluded: null };
  const kept = points.filter(
    (point) => !(Math.abs(point.value) < RESTING_ACCELERATION),
  );
  const values = points
    .filter((point) => Math.abs(point.value) < RESTING_ACCELERATION)
    .map((point) => point.x);
  return {
    kept,
    excluded: values.length
      ? { values, reason: "at rest; the incline law describes sliding only" }
      : null,
  };
}

/**
 * Constants an expression may use besides `pi` and `deg`. A model that fits one of them,
 * such as g for the pendulum, leaves it out so it becomes a parameter.
 */
export function fitConstants(
  scene: LabScene,
  fits: readonly string[] = [],
): Record<string, number> {
  const constants: Record<string, number> = { g: scene.gravity };
  for (const name of fits) delete constants[name];
  return constants;
}

/** The family of a sweep's metric: the second part of a reference id or of a probe key. */
const metricFamily = (spec: SweepSpec) => {
  const metric = spec.metric;
  if (metric.kind === "stop_time") return {};
  const [target, family] = (
    metric.kind === "reference" ? metric.id : metric.key
  ).split(".");
  return { target, family };
};

/**
 * Parameters with a configured value in the swept scene: μ on the incline, g for a pendulum
 * period, k for a spring period swept over mass.
 */
export function knownParameters(
  scene: LabScene,
  spec: SweepSpec,
): Record<string, KnownParameter> {
  const known: Record<string, KnownParameter> = {};
  const { target, family } = metricFamily(spec);
  const part = scene.objects.find((item) => item.id === target);
  if (!part) return known;
  if (part.kind === "pendulum" && spec.variable !== "gravity")
    known.g = { value: scene.gravity, source: "Scene gravity" };
  if (part.kind === "spring" && spec.variable !== `${part.id}.stiffness`)
    known.k = { value: part.stiffness, source: `${part.id} stiffness` };
  if (family !== "incline" || !isBody(part)) return known;
  const start = startingRamp(part, scene);
  if (start && spec.variable !== `${start.ramp.id}.friction`)
    known.mu = {
      value: start.ramp.friction,
      source: `${start.ramp.id} friction`,
    };
  return known;
}

/** Fits the sweep's readings when it has synthetic noise, else its clean values. */
export function fitSweep(
  scene: LabScene,
  spec: SweepSpec,
  points: SweepPoint[],
  model: FitModelId,
  expression: string,
): SweepFit {
  const preset = model === "custom" ? undefined : presetById(model);
  const source = preset?.expression ?? expression;
  const noisy = spec.noise !== null;
  const { kept, excluded } = fitPoints(model, points);
  const { xs, ys } = fitData(kept, noisy);
  const sigma = spec.noise ? readingUncertainty(spec.noise) : undefined;
  const { result, compiled } = fitExpression(source, xs, ys, {
    constants: fitConstants(scene, preset?.fits),
    preset,
    sigma,
  });
  const values = result.parameters.map((parameter) => parameter.value);
  const known = knownParameters(scene, spec);
  return {
    model,
    result,
    compiled,
    sigma,
    excluded,
    known: Object.fromEntries(
      Object.entries(known).filter(([name]) =>
        compiled.parameters.includes(name),
      ),
    ),
    curve: {
      at: (x) => compiled.evaluate(x, values),
      band: (x) => BAND_COVERAGE * bandAt(compiled.evaluate, result, x).se,
      label: `Fit ± ${BAND_COVERAGE} SE`,
    },
  };
}
