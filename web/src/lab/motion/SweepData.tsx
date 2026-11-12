import { Download, SlidersHorizontal, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FIT_PRESETS, type FitModelId } from "../data/fit";
import { SweepPlot } from "../data/SweepPlot";
import type { LabScene } from "../scene";
import { canonicalJson } from "./run";
import { metricOption, sweepVariables, type SweepSpec } from "./sweep";
import { fitSweep, type SweepFit } from "./sweepFit";
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

/** The model a sweep suggests: the incline law for an angle sweep of its acceleration. */
export function suggestedModel(spec: SweepSpec): FitModelId {
  return spec.metric.kind === "reference" &&
    spec.metric.id.endsWith(".incline.a") &&
    spec.variable.endsWith(".angle")
    ? "incline"
    : "linear";
}

/** Axis titles for the swept variable and the metric. */
export function sweepAxes(scene: LabScene, spec: SweepSpec) {
  const variable = sweepVariables(scene).find(
    (item) => item.path === spec.variable,
  );
  const metric = metricOption(scene, spec.metric);
  return {
    x: {
      label: variable?.label ?? spec.variable,
      symbol: variable?.symbol ?? "x",
      unit: variable?.unit ?? "",
    },
    y: {
      label: metric?.label ?? "Metric",
      symbol: metric?.symbol ?? "y",
      unit: metric?.unit ?? "",
    },
  };
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
          {state.spec.noise
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
  const total = state?.spec.values.length ?? 0;
  const values = state?.spec.values ?? [];
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
              Vary one input across a range and read one result from each run.
            </p>
          ) : state.error ? (
            <p className="lab-error" role="alert">
              {state.error}
            </p>
          ) : (
            <SweepPlot
              points={state.points}
              xAxis={axes.x}
              yAxis={axes.y}
              domain={[values[0], values[values.length - 1]]}
              color={color}
              fit={state.fit?.curve}
            />
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
