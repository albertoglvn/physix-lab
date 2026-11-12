import { Download, Info, Ruler } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Segmented } from "../../ui/controls";
import { formatDelta, formatStep } from "../data/methods";
import { Plot } from "../data/Plot";
import type { LabScene } from "../scene";
import type { ConvergenceResult } from "./convergence";
import { SYSTEM, type Quantity } from "./probes";
import { eventOf, type MotionRun } from "./run";
import type { Comparison, Reference, TheoryCurve } from "./theory";

const DEFAULT_QUANTITY: Record<string, string> = {
  block: "speed",
  pulley: "speed",
  [SYSTEM]: "energy",
};
const SERIES_COLOURS = [
  "var(--px-series-1)",
  "var(--px-series-2)",
  "var(--px-series-3)",
  "var(--px-series-4)",
  "var(--px-series-5)",
  "var(--px-series-6)",
];

/** The probe target for a selection: a block or pulley, or the whole system. */
export function probeTarget(scene: LabScene, selected: string | null) {
  const part = scene.objects.find((item) => item.id === selected);
  return part && part.kind !== "ramp" ? part.id : SYSTEM;
}

/** Bodies take series colours in creation order (DESIGN.md §3). */
export function seriesColour(scene: LabScene, target: string) {
  const bodies = scene.objects.filter((part) => part.kind !== "ramp");
  const index = Math.max(
    0,
    bodies.findIndex((part) => part.id === target),
  );
  return SERIES_COLOURS[index % SERIES_COLOURS.length];
}

/** When a run has the value a reference needs: its event, or the end of the run. */
export function revealTime(reference: Reference, run: MotionRun) {
  if (!reference.event) return run.stop.t;
  return eventOf(run, reference.event, reference.target)?.t ?? run.stop.t;
}

const significant = (value: number) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(4))) : "—";

export type StepCheck = {
  reference: Reference;
  result?: ConvergenceResult;
  error?: string;
};

export type DataView = "plot" | "table" | "sweep";

export type MotionDataProps = {
  scene: LabScene;
  target: string;
  run?: MotionRun;
  runError?: string;
  /** The live run's time; samples and results after it stay hidden. */
  time: number;
  comparisons: Comparison[];
  curves: TheoryCurve[];
  check?: StepCheck;
  onCheck: (reference: Reference) => void;
  onExport: () => void;
  /** The view, when the study controls it; the dock keeps its own otherwise. */
  view?: DataView;
  onViewChange?: (view: DataView) => void;
  /** Renders the sweep view around the dock's view switcher. */
  renderSweep?: (switcher: ReactNode) => ReactNode;
};

function StepCheckLine({ check }: { check: StepCheck }) {
  const { result, error, reference } = check;
  if (error) return <p className="lab-check lab-error">{error}</p>;
  if (!result)
    return (
      <p className="lab-check" aria-live="polite">
        Checking {reference.label.toLowerCase()} at three step sizes…
      </p>
    );
  const steps = result.steps.map(formatStep).join(" · ");
  return (
    <p className="lab-check" aria-live="polite">
      <span
        className="lab-chip"
        data-tone={result.passed ? "ok" : "warn"}
        title={`Pass when the change between the two finest steps is at most ${result.tolerance * 100} %.`}
      >
        {result.passed ? "Converged" : "Not converged"}
      </span>
      <span className="num">
        {reference.symbol}{" "}
        {result.change === undefined
          ? "—"
          : `changes ${significant(result.change * 100)} %`}
        {result.order !== undefined
          ? ` · order ${result.order.toFixed(2)}`
          : ""}
      </span>
      <span
        className="lab-info"
        role="img"
        aria-label={`Steps ${steps}. Values ${result.values.map((value) => (value === undefined ? "—" : significant(value))).join(", ")} ${result.unit}. ${result.note ?? ""}`}
        title={`Steps ${steps}\nValues ${result.values.map((value) => (value === undefined ? "—" : significant(value))).join(", ")} ${result.unit}${result.note ? `\n${result.note}` : ""}`}
      >
        <Info size={14} aria-hidden="true" />
      </span>
    </p>
  );
}

function ComparisonRow({
  comparison,
  shown,
}: {
  comparison: Comparison;
  shown: boolean;
}) {
  const { reference, measured, within } = comparison;
  const help = [
    `${reference.formula} = ${significant(reference.value)} ${reference.unit}`,
    ...reference.assumptions,
  ];
  return (
    <li>
      <div className="lab-compare-head">
        <span>
          {reference.label} <i>{reference.symbol}</i>
          {reference.target !== SYSTEM ? (
            <small> · {reference.target}</small>
          ) : null}
        </span>
        <span
          className="lab-info"
          role="img"
          aria-label={help.join(" ")}
          title={help.join("\n")}
        >
          <Info size={14} aria-hidden="true" />
        </span>
      </div>
      <dl className="lab-compare-values">
        <div>
          <dt>Sim</dt>
          <dd className="num">
            {shown && measured !== undefined ? significant(measured) : "—"}
          </dd>
        </div>
        <div>
          <dt>Theory</dt>
          <dd className="num">
            {significant(reference.value)} <small>{reference.unit}</small>
          </dd>
        </div>
        <div>
          {reference.broken ? (
            <span
              className="lab-chip"
              data-tone="warn"
              title={reference.broken}
            >
              Assumption broken
            </span>
          ) : !shown || measured === undefined ? (
            <span className="lab-chip">Pending</span>
          ) : (
            <span
              className="lab-chip num"
              data-tone={within ? "ok" : "warn"}
              title={`Tolerance ${reference.tolerance * 100} %`}
            >
              Δ {formatDelta(comparison)}
            </span>
          )}
        </div>
      </dl>
    </li>
  );
}

/** The Motion dock: a plot or table of one probe, the theory comparisons and the step check. */
export function MotionData({
  scene,
  target,
  run,
  runError,
  time,
  comparisons,
  curves,
  check,
  onCheck,
  onExport,
  view: controlledView,
  onViewChange,
  renderSweep,
}: MotionDataProps) {
  const [ownView, setOwnView] = useState<DataView>("plot");
  const view = controlledView ?? ownView;
  const setView = onViewChange ?? setOwnView;
  const [choice, setChoice] = useState<Record<string, string>>({});
  const quantities: Quantity[] = (run?.quantities ?? []).filter(
    (quantity) => quantity.target === target,
  );
  const kind =
    target === SYSTEM
      ? SYSTEM
      : (scene.objects.find((part) => part.id === target)?.kind ?? SYSTEM);
  const wanted = choice[target] ?? `${target}.${DEFAULT_QUANTITY[kind]}`;
  const quantity =
    quantities.find(({ key }) => key === wanted) ?? quantities[0];
  const curve = curves.find(({ key }) => key === quantity?.key);
  const checkable = comparisons.find(
    ({ reference }) => !reference.broken && Number.isFinite(reference.value),
  );
  const rows = run
    ? run.series.t.flatMap((t, index) => (t <= time + 1e-9 ? [index] : []))
    : [];

  const switcher = (
    <Segmented
      label="Data view"
      value={view}
      options={[
        { value: "plot", label: "Plot" },
        { value: "table", label: "Table" },
        ...(renderSweep ? [{ value: "sweep" as const, label: "Sweep" }] : []),
      ]}
      onChange={setView}
    />
  );
  if (view === "sweep" && renderSweep) return renderSweep(switcher);

  return (
    <div className="lab-data">
      <div className="lab-data-bar">
        {switcher}
        {view === "plot" && quantities.length ? (
          <select
            className="px-input lab-data-quantity"
            aria-label="Quantity"
            value={quantity?.key}
            onChange={(event) => {
              const key = event.currentTarget.value;
              setChoice((previous) => ({ ...previous, [target]: key }));
            }}
          >
            {quantities.map(({ key, label, unit }) => (
              <option key={key} value={key}>
                {label} ({unit})
              </option>
            ))}
          </select>
        ) : null}
        <span className="lab-data-target">
          {target === SYSTEM ? "System" : target}
        </span>
        <span className="lab-data-actions">
          <button
            type="button"
            className="lab-button"
            disabled={
              !run || !checkable || (check && !check.result && !check.error)
            }
            onClick={() => checkable && onCheck(checkable.reference)}
            title="Re-run at Δt, Δt/2 and Δt/4 and compare"
          >
            <Ruler size={15} aria-hidden="true" />
            <span>Check step</span>
          </button>
          <button
            type="button"
            className="lab-button"
            disabled={!run}
            onClick={onExport}
          >
            <Download size={15} aria-hidden="true" />
            <span>Export</span>
          </button>
        </span>
      </div>
      <div className="lab-data-body">
        <div className="lab-data-main">
          {runError ? (
            <p className="lab-error" role="alert">
              {runError}
            </p>
          ) : !run || !quantity ? (
            <p className="lab-note">
              {run ? "Add a block or pulley to record data." : "Recording…"}
            </p>
          ) : view === "plot" ? (
            <Plot
              series={{
                label: quantity.label,
                symbol: quantity.symbol,
                unit: quantity.unit,
                color: seriesColour(scene, target),
                t: run.series.t,
                values: run.series.columns[quantity.key],
              }}
              curve={curve}
              domain={run.stop.t}
              until={time}
            />
          ) : (
            <div className="lab-table-wrap">
              <table className="lab-table">
                <thead>
                  <tr>
                    <th scope="col">
                      t <small>s</small>
                    </th>
                    {quantities.map(({ key, symbol, unit }) => (
                      <th key={key} scope="col">
                        {symbol} <small>{unit}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((index) => (
                    <tr key={index}>
                      <td className="num">{run.series.t[index].toFixed(4)}</td>
                      {quantities.map(({ key }) => (
                        <td key={key} className="num">
                          {significant(run.series.columns[key][index])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length ? (
                <p className="lab-note">Run the scene to fill the table.</p>
              ) : null}
            </div>
          )}
        </div>
        <aside className="lab-data-side" aria-label="Theory comparison">
          {comparisons.length ? (
            <ul className="lab-compare">
              {comparisons.map((comparison) => (
                <ComparisonRow
                  key={comparison.reference.id}
                  comparison={comparison}
                  shown={
                    !!run &&
                    time + 1e-9 >= revealTime(comparison.reference, run)
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="lab-note">No closed-form reference for this scene.</p>
          )}
          {check ? <StepCheckLine check={check} /> : null}
        </aside>
      </div>
    </div>
  );
}
