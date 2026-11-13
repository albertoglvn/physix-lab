import { Download, SlidersHorizontal, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FIT_PRESETS, type FitModelId } from "../data/fit";
import { formatValue } from "../data/Plot";
import { SweepPlot, type ScatterGroup } from "../data/SweepPlot";
import type { LabScene } from "../scene";
import { canonicalJson } from "./run";
import {
  metricOption,
  pointCount,
  sweepVariables,
  type SweepPoint,
  type SweepSpec,
} from "./sweep";
import {
  fitSweep,
  residualFit,
  residualPoints,
  type SweepFit,
} from "./sweepFit";
import type { SweepState } from "./useSweep";

const DISPLAY_NAMES: Record<string, string> = { mu: "μ" };
export const parameterName = (name: string) => DISPLAY_NAMES[name] ?? name;

/** A value and its standard error, both rounded to the error's second significant digit. */
export function formatEstimate(value: number, se: number): string {
  if (!Number.isFinite(value)) return "—";
  if (!(se > 0) || !Number.isFinite(se))
    return String(Number(value.toPrecision(6)));
  const digits = Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(se))));
  return `${value.toFixed(digits)} ± ${se.toFixed(digits)}`;
}

const significant = (value: number) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(4))) : "—";

/**
 * The model a sweep suggests: the incline law for an angle sweep of its acceleration, the
 * pendulum law for a length sweep of its period, the spring law for a mass sweep of its period.
 */
export function suggestedModel(spec: SweepSpec): FitModelId {
  if (spec.metric.kind !== "reference") return "linear";
  const id = spec.metric.id;
  const [target] = id.split(".");
  if (id.endsWith(".incline.a") && spec.variable.endsWith(".angle"))
    return "incline";
  if (id.includes(".pendulum.T") && spec.variable === `${target}.length`)
    return "pendulum";
  if (id.endsWith(".spring.T") && spec.variable === `${target}.mass`)
    return "spring";
  return "linear";
}

/** Axis titles for the swept variables and the metric. */
export function sweepAxes(scene: LabScene, spec: SweepSpec) {
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
    x: axis(spec.variable, "x"),
    ...(spec.second ? { x2: axis(spec.second.variable, "x₂") } : {}),
    perturbed: spec.perturbation
      ? axis(spec.perturbation.variable, "u")
      : undefined,
    y: {
      label: metric?.label ?? "Metric",
      symbol: metric?.symbol ?? "y",
      unit: metric?.unit ?? "",
    },
  };
}

/** Slices a grid plot draws at most: one per data-palette colour. */
export const SLICE_LIMIT = 6;
const SLICE_COLOURS = [
  "var(--px-series-1)",
  "var(--px-series-2)",
  "var(--px-series-3)",
  "var(--px-series-4)",
  "var(--px-series-5)",
  "var(--px-series-6)",
];

/** At most `limit` slice indices, evenly spread, always with the first and last. */
export function sliceIndices(count: number, limit = SLICE_LIMIT): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, index) => index);
  const chosen = Array.from({ length: limit }, (_, order) =>
    Math.round((order * (count - 1)) / (limit - 1)),
  );
  return [...new Set(chosen)];
}

/** A grid's points as slices along its second variable, the first in the dock's colour. */
export function gridSlices(
  spec: SweepSpec,
  points: SweepPoint[],
  axis: { symbol: string; unit: string },
  color: string,
): ScatterGroup[] {
  const { second } = spec;
  if (!second) return [];
  const colours = [color, ...SLICE_COLOURS.filter((item) => item !== color)];
  return sliceIndices(second.values.length).map((column, order) => {
    const value = second.values[column];
    return {
      label: `${axis.symbol} = ${formatValue(value)}${axis.unit ? ` ${axis.unit}` : ""}`,
      color: colours[order % colours.length],
      points: points.filter((point) => point.x2 === value),
    };
  });
}

function FitPanel({
  state,
  onFit,
}: {
  state: SweepState;
  onFit: (fit: SweepFit | undefined) => void;
}) {
  const [model, setModel] = useState<FitModelId>(() =>
    suggestedModel(state.spec),
  );
  const [expression, setExpression] = useState("a + b*x");
  const [error, setError] = useState("");
  const { fit } = state;
  const ready = state.status !== "running" && state.points.length > 0;
  if (state.spec.second)
    return (
      <p className="lab-note">
        A fit takes one swept variable. Export the grid as CSV to fit it
        elsewhere, or sweep one variable at a time.
      </p>
    );

  function run() {
    try {
      onFit(fitSweep(state.scene, state.spec, state.points, model, expression));
      setError("");
    } catch (failure) {
      onFit(undefined);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <>
      <div className="lab-fit-controls">
        <label className="lab-select lab-select--inline">
          <span>Fit model</span>
          <select
            className="px-input"
            value={model}
            onChange={(event) => {
              setModel(event.currentTarget.value as FitModelId);
              setError("");
            }}
          >
            {FIT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom expression</option>
          </select>
        </label>
        <button
          type="button"
          className="lab-button"
          disabled={!ready}
          onClick={run}
        >
          Fit
        </button>
      </div>
      {model === "custom" ? (
        <label className="lab-select lab-select--inline">
          <span>
            y = <small>in x; constants g, pi, deg</small>
          </span>
          <input
            className="px-input lab-expression"
            value={expression}
            spellCheck={false}
            aria-label="Fit expression"
            onChange={(event) => {
              setExpression(event.currentTarget.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && ready) run();
            }}
          />
        </label>
      ) : null}
      {error ? (
        <p className="lab-error" role="alert">
          {error}
        </p>
      ) : null}
      {fit ? <FitSummary fit={fit} /> : null}
      {!fit && !error ? (
        <p className="lab-note">
          {state.spec.perturbation
            ? state.spec.noise
              ? "Fits every perturbed reading, weighted by the sensor σ; the perturbation adds scatter those weights leave out."
              : "Fits every perturbed reading, unweighted."
            : state.spec.noise
              ? "Fits every synthetic reading, weighted by its σ."
              : "Fits the simulated values, unweighted."}
        </p>
      ) : null}
    </>
  );
}

function FitSummary({ fit }: { fit: SweepFit }) {
  const { result, known } = fit;
  return (
    <dl className="lab-fit" aria-live="polite">
      {result.parameters.map((parameter) => {
        const configured = known[parameter.name];
        const within =
          configured &&
          Math.abs(parameter.value - configured.value) <= 2 * parameter.se;
        return (
          <div key={parameter.name}>
            <dt>{parameterName(parameter.name)}</dt>
            <dd className="num">
              {formatEstimate(parameter.value, parameter.se)}
              {configured ? (
                <span
                  className="lab-chip"
                  data-tone={within ? "ok" : "warn"}
                  title={`Configured as ${configured.value} (${configured.source}).`}
                >
                  {within ? "Within 2 SE of" : "Outside 2 SE of"}{" "}
                  {configured.value}
                </span>
              ) : null}
            </dd>
          </div>
        );
      })}
      <div>
        <dt>R²</dt>
        <dd className="num">{result.r2.toFixed(5)}</dd>
      </div>
      {result.reducedChi2 !== undefined ? (
        <div>
          <dt>χ²/dof</dt>
          <dd className="num">
            {significant(result.reducedChi2)} <small>dof {result.dof}</small>
          </dd>
        </div>
      ) : null}
      <div>
        <dt>Points</dt>
        <dd className="num">
          {result.n}
          {fit.excluded ? (
            <small
              title={`Excluded ${fit.excluded.values.join(", ")}: ${fit.excluded.reason}.`}
            >
              {fit.excluded.values.length} at rest excluded
            </small>
          ) : null}
          {result.converged ? null : (
            <span className="lab-chip" data-tone="warn">
              Not converged
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

export type SweepDataProps = {
  state?: SweepState;
  /** The scene in the viewport, to flag a sweep of an earlier version. */
  scene: LabScene;
  color: string;
  /** The dock's view switcher, shown first in the bar. */
  switcher: ReactNode;
  onSetup: () => void;
  onCancel: () => void;
  onExport: () => void;
  onFit: (fit: SweepFit | undefined) => void;
};

/** The dock's sweep view: progress, the sweep plot and the fit (LAB_PLAN.md §3.2). */
export function SweepData({
  state,
  scene,
  color,
  switcher,
  onSetup,
  onCancel,
  onExport,
  onFit,
}: SweepDataProps) {
  const running = state?.status === "running";
  const axes = state ? sweepAxes(state.scene, state.spec) : undefined;
  const total = state ? pointCount(state.spec) : 0;
  const values = state?.spec.values ?? [];
  const slices =
    state && axes?.x2
      ? gridSlices(state.spec, state.points, axes.x2, color)
      : undefined;
  const sliceCount = state?.spec.second?.values.length ?? 0;
  return (
    <div className="lab-data">
      <div className="lab-data-bar">
        {switcher}
        {state && axes ? (
          <>
            <span className="lab-data-target">
              {axes.x.symbol} → {axes.y.symbol}
            </span>
            {running ? (
              <span className="lab-chip num" aria-live="polite">
                {state.points.length} / {total} points
              </span>
            ) : state.status === "cancelled" ? (
              <span className="lab-chip num">
                Cancelled at {state.points.length} / {total}
              </span>
            ) : null}
            {state.spec.noise ? (
              <span
                className="lab-chip"
                data-tone="warn"
                title={`Seeded virtual-sensor noise, seed ${state.spec.seed}; the simulated values are kept apart.`}
              >
                Synthetic noise · σ {state.spec.noise.sigma} {axes.y.unit}
              </span>
            ) : null}
            {state.spec.perturbation && axes.perturbed ? (
              <span
                className="lab-chip"
                data-tone="warn"
                title={`Each repeat reruns the point from ${axes.perturbed.label} plus a seeded Gaussian draw, seed ${state.spec.seed}; the clean run is kept apart.`}
              >
                Perturbed start · σ {state.spec.perturbation.sigma}{" "}
                {axes.perturbed.unit}
              </span>
            ) : null}
            {state.scene !== scene &&
            canonicalJson(state.scene) !== canonicalJson(scene) ? (
              <span
                className="lab-chip"
                title="The scene has changed since this sweep ran."
              >
                Earlier scene
              </span>
            ) : null}
          </>
        ) : null}
        <span className="lab-data-actions">
          {running ? (
            <button type="button" className="lab-button" onClick={onCancel}>
              <Square size={15} aria-hidden="true" />
              <span>Cancel</span>
            </button>
          ) : (
            <button type="button" className="lab-button" onClick={onSetup}>
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span>Sweep setup</span>
            </button>
          )}
          <button
            type="button"
            className="lab-button"
            disabled={!state?.record}
            onClick={onExport}
          >
            <Download size={15} aria-hidden="true" />
            <span>Export</span>
          </button>
        </span>
      </div>
      <div className="lab-data-body">
        <div className="lab-data-main">
          {!state || !axes ? (
            <p className="lab-note">
              Vary one input across a range, or two on a grid, and read one
              result from each run.
            </p>
          ) : state.error ? (
            <p className="lab-error" role="alert">
              {state.error}
            </p>
          ) : (
            <>
              <SweepPlot
                points={state.points}
                groups={slices}
                xAxis={axes.x}
                yAxis={axes.y}
                domain={[values[0], values[values.length - 1]]}
                color={color}
                fit={state.fit?.curve}
              />
              {slices && sliceCount > slices.length ? (
                <p className="lab-note">
                  Showing {slices.length} of {sliceCount} values of{" "}
                  {axes.x2?.label}; the export has every point.
                </p>
              ) : null}
              {state.fit ? (
                <SweepPlot
                  points={residualPoints(state.points, state.fit)}
                  xAxis={axes.x}
                  yAxis={{
                    label: "Residual",
                    symbol: `${axes.y.symbol} − fit`,
                    unit: axes.y.unit,
                  }}
                  domain={[values[0], values[values.length - 1]]}
                  color={color}
                  fit={residualFit(state.fit)}
                  height={130}
                />
              ) : null}
            </>
          )}
        </div>
        <aside className="lab-data-side" aria-label="Fit">
          {state ? (
            <FitPanel key={state.serial} state={state} onFit={onFit} />
          ) : (
            <p className="lab-note">A fit appears here once a sweep has run.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
