/**
 * The sweep setup form: text fields as typed, defaults for a scene, and the conversion to a
 * validated `SweepSpec`. Kept apart from the sheet so the rules are testable.
 */

import { niceTicks } from "../data/Plot";
import { freshSeed } from "../data/random";
import { hasDrag, isBody, type LabScene } from "../scene";
import { TIME_STEP } from "../simulation";
import type { Protocol } from "./probes";
import {
  applySweepValue,
  metricKey,
  parseSweepSpec,
  perturbationVariables,
  sweepMetrics,
  sweepValues,
  sweepVariables,
  type SweepSpec,
} from "./sweep";
import { referencesFor } from "./theory";

export type SweepForm = {
  variable: string;
  from: string;
  to: string;
  step: string;
  /** A `metricKey`. */
  metric: string;
  noise: boolean;
  sigma: string;
  resolution: string;
  repeats: string;
  seed: string;
  /** A second variable, run on a grid with the first. */
  grid: boolean;
  variable2: string;
  from2: string;
  to2: string;
  step2: string;
  /** Repeats rerun each point from a seeded perturbation of one initial condition. */
  perturb: boolean;
  perturbVariable: string;
  perturbSigma: string;
};

/** About ten round steps across the variable's limits. */
export function defaultRange(min: number, max: number) {
  const { ticks } = niceTicks(min, max, 10);
  if (ticks.length < 2) return { from: min, to: max, step: max - min || 1 };
  return {
    from: ticks[0],
    to: ticks[ticks.length - 1],
    step: Number((ticks[1] - ticks[0]).toPrecision(12)),
  };
}

/** The variable a template's closed form most depends on. */
export function defaultVariable(scene: LabScene): string {
  const paths = sweepVariables(scene).map((item) => item.path);
  const references = referencesFor(scene);
  const ramp = scene.objects.find((part) => part.kind === "ramp");
  const pulley = scene.objects.find((part) => part.kind === "pulley");
  const pendulum = scene.objects.find((part) => part.kind === "pendulum");
  const spring = scene.objects.find((part) => part.kind === "spring");
  const launched = scene.objects.find((part) => isBody(part) && part.vx !== 0);
  const pushed = scene.objects.find((part) => isBody(part) && part.force);
  const preferred = [
    ramp && `${ramp.id}.angle`,
    pulley && `${pulley.id}.rightMass`,
    pendulum && `${pendulum.id}.length`,
    spring && `${spring.id}.mass`,
    references.some((item) => item.id.endsWith(".friction.d")) &&
      "floorFriction",
    launched && `${launched.id}.vx`,
    pushed && `${pushed.id}.force.x`,
    hasDrag(scene) && (scene.airDensity > 0 ? "airDensity" : "linearDrag"),
  ];
  return (
    preferred.find(
      (path): path is string =>
        typeof path === "string" && paths.includes(path),
    ) ?? paths[0]
  );
}

const show = (value: number) => String(Number(value.toPrecision(6)));

/**
 * About ten round steps across the values the scene accepts: the variable's limits, trimmed
 * where a value would put a pendulum bob or spring cube through the floor or anchor.
 */
function sceneRange(scene: LabScene, path: string, min: number, max: number) {
  const accepts = (value: number) => {
    try {
      applySweepValue(scene, path, value);
      return true;
    } catch {
      return false;
    }
  };
  const trim = (low: number, high: number) => {
    const range = defaultRange(low, high);
    const values = sweepValues(range.from, range.to, range.step);
    const valid = values.filter(accepts);
    return { range, values, valid };
  };
  let { range, values, valid } = trim(min, max);
  if (valid.length >= 2 && valid.length < values.length - 1) {
    // Refine between the nearest rejected values so the trimmed range keeps about ten steps.
    const first = values.indexOf(valid[0]);
    const last = values.indexOf(valid[valid.length - 1]);
    ({ range, values, valid } = trim(
      Math.max(min, values[first - 1] ?? min),
      Math.min(max, values[last + 1] ?? max),
    ));
  }
  if (valid.length < 2) return range;
  return { ...range, from: valid[0], to: valid[valid.length - 1] };
}

function rangeFields(scene: LabScene, variable: string) {
  const known = sweepVariables(scene).find((item) => item.path === variable);
  if (!known) return undefined;
  const range = sceneRange(scene, variable, known.min, known.max);
  return {
    from: show(range.from),
    to: show(range.to),
    step: show(range.step),
  };
}

/** The form for one variable: its default range, and the other fields as they were. */
export function formForVariable(
  scene: LabScene,
  form: SweepForm,
  variable: string,
): SweepForm {
  const range = rangeFields(scene, variable);
  return range ? { ...form, variable, ...range } : { ...form, variable };
}

/** The form for a grid's second variable, with about ten steps across its range. */
export function formForSecond(
  scene: LabScene,
  form: SweepForm,
  variable2: string,
): SweepForm {
  const range = rangeFields(scene, variable2);
  // About five values keep a grid with a ten-value first axis near 50 runs.
  const step =
    range &&
    show(
      (Number(range.to) - Number(range.from)) /
        Math.max(
          1,
          Math.min(
            4,
            Math.round(
              (Number(range.to) - Number(range.from)) / Number(range.step),
            ),
          ),
        ),
    );
  return range
    ? { ...form, variable2, from2: range.from, to2: range.to, step2: step! }
    : { ...form, variable2 };
}

/** The form for a perturbed initial condition, with σ of one default step. */
export function formForPerturbation(
  scene: LabScene,
  form: SweepForm,
  perturbVariable: string,
): SweepForm {
  const known = perturbationVariables(scene).find(
    (item) => item.path === perturbVariable,
  );
  return known
    ? { ...form, perturbVariable, perturbSigma: show(known.step) }
    : { ...form, perturbVariable };
}

/** A second variable other than the first: the next one in the scene's list. */
function otherVariable(scene: LabScene, variable: string) {
  const paths = sweepVariables(scene).map((item) => item.path);
  return paths.find((path) => path !== variable) ?? "";
}

/** A fresh form for the scene: its main variable and first metric, noise off. */
export function defaultSweepForm(
  scene: LabScene,
  seed = freshSeed(),
): SweepForm {
  const [first] = sweepMetrics(scene);
  const variable = defaultVariable(scene);
  const form = formForVariable(
    scene,
    {
      variable: "",
      from: "",
      to: "",
      step: "",
      metric: first ? metricKey(first.metric) : "stop_time",
      noise: false,
      sigma: "0.05",
      resolution: "0.001",
      repeats: "3",
      seed: String(seed),
      grid: false,
      variable2: "",
      from2: "",
      to2: "",
      step2: "",
      perturb: false,
      perturbVariable: "",
      perturbSigma: "",
    },
    variable,
  );
  const [initial] = perturbationVariables(scene);
  return formForPerturbation(
    scene,
    formForSecond(scene, form, otherVariable(scene, variable)),
    initial?.path ?? "",
  );
}

/** Keeps a previous form where it still fits the scene; otherwise starts afresh. */
export function reconcileForm(
  scene: LabScene,
  form: SweepForm | undefined,
): SweepForm {
  if (!form) return defaultSweepForm(scene);
  const variables = sweepVariables(scene).map((item) => item.path);
  const metrics = sweepMetrics(scene).map((item) => metricKey(item.metric));
  const initial = perturbationVariables(scene).map((item) => item.path);
  let next = form;
  if (!variables.includes(form.variable))
    next = formForVariable(scene, next, defaultVariable(scene));
  if (!variables.includes(next.variable2) || next.variable2 === next.variable)
    next = formForSecond(scene, next, otherVariable(scene, next.variable));
  const stale = initial.length
    ? !initial.includes(next.perturbVariable)
    : next.perturbVariable !== "" || next.perturb;
  if (stale)
    next = {
      ...formForPerturbation(scene, next, initial[0] ?? ""),
      perturb: next.perturb && initial.length > 0,
    };
  if (!metrics.includes(next.metric))
    next = { ...next, metric: metrics[0] ?? "stop_time" };
  return next;
}

function number(text: string, label: string): number {
  const value = Number(text.trim().replace(/\s+/g, "").replace("−", "-"));
  if (!text.trim() || !Number.isFinite(value))
    throw new Error(`${label} must be a number.`);
  return value;
}

export type FormOutcome =
  { spec: SweepSpec; error?: never } | { spec?: never; error: string };

/** Converts the form to a validated spec, or explains the first problem. */
export function formToSpec(
  form: SweepForm,
  scene: LabScene,
  protocol: Protocol,
  timeStep = TIME_STEP,
): FormOutcome {
  try {
    const option = sweepMetrics(scene).find(
      (item) => metricKey(item.metric) === form.metric,
    );
    if (!option) throw new Error("Choose a metric to read from each run.");
    const values = sweepValues(
      number(form.from, "From"),
      number(form.to, "To"),
      number(form.step, "Step"),
    );
    const second = form.grid
      ? {
          variable: form.variable2,
          values: sweepValues(
            number(form.from2, "Second from"),
            number(form.to2, "Second to"),
            number(form.step2, "Second step"),
          ),
        }
      : undefined;
    const noise = form.noise
      ? {
          sigma: number(form.sigma, "σ"),
          resolution: number(form.resolution || "0", "Resolution"),
        }
      : null;
    const perturbation = form.perturb
      ? {
          variable: form.perturbVariable,
          sigma: number(form.perturbSigma, "Perturbation σ"),
        }
      : undefined;
    return {
      spec: parseSweepSpec(
        {
          variable: form.variable,
          values,
          second,
          metric: option.metric,
          repeats: noise || perturbation ? number(form.repeats, "Repeats") : 1,
          seed: number(form.seed, "Seed"),
          noise,
          perturbation,
          protocol,
          timeStep,
        },
        scene,
      ),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
