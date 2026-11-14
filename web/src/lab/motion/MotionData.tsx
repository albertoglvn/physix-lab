import {
  BookmarkPlus,
  Download,
  Info,
  Pin,
  RotateCcw,
  Ruler,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Segmented } from "../../ui/controls";
import { formatDelta, formatStep } from "../data/methods";
import { Plot, type PlotOverlay } from "../data/Plot";
import type { LabScene } from "../scene";
import {
  COMPARE_LIMIT,
  inputDifferences,
  overlaidRuns,
  runLabel,
  type SavedRun,
} from "../state/runs";
import type { ConvergenceResult } from "./convergence";
import { SYSTEM, type Quantity } from "./probes";
import { eventOf, type MotionRun } from "./run";
import type { Comparison, Reference, TheoryCurve } from "./theory";

const DEFAULT_QUANTITY: Record<string, string> = {
  block: "speed",
  ball: "speed",
  pulley: "speed",
  pendulum: "angle",
  spring: "displacement",
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

/** The probe target for a selection: any moving part, or the whole system for a ramp. */
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

/** The run history the dock shows as chips over the plot. */
export type RunHistoryControls = {
  runs: SavedRun[];
  compared: string[];
  /** The id of the stored run being re-run, while the check runs. */
  checking?: string;
  onKeep: () => void;
  onToggle: (id: string) => void;
  onPin: (id: string) => void;
  onRemove: (id: string) => void;
  onRecheck: (run: MotionRun) => void;
};

/** Colours for compared runs: the data palette less the live series' colour. */
export const overlayColours = (current: string) =>
  SERIES_COLOURS.filter((colour) => colour !== current);

/** The stored runs overlaid on the plot, each with its colour and chip label. */
export function runOverlays(
  history: RunHistoryControls,
  run: MotionRun,
  colour: string,
): { entry: SavedRun; color: string; label: string }[] {
  const colours = overlayColours(colour);
  return overlaidRuns(history.runs, history.compared, run.id).map(
    (entry, index) => {
      const label = runLabel(inputDifferences(entry.run.inputs, run.inputs));
      return {
        entry,
        color: colours[index % colours.length],
        label: entry.pinned ? `Baseline · ${label}` : label,
      };
    },
  );
}

function RunChips({
  history,
  run,
  colour,
  overlays,
}: {
  history: RunHistoryControls;
  run: MotionRun;
  colour: string;
  overlays: ReturnType<typeof runOverlays>;
}) {
  const colourOf = new Map(
    overlays.map(({ entry, color }) => [entry.run.id, color]),
  );
  const kept = history.runs.some((entry) => entry.run.id === run.id);
  const full = overlays.length >= COMPARE_LIMIT - 1;
  return (
    <div className="lab-runs" role="group" aria-label="Run history">
      <button
        type="button"
        className="lab-button"
        disabled={kept}
        onClick={history.onKeep}
        title="Keep this run in the history. Runs that reach their stop are kept on their own."
      >
        <BookmarkPlus size={15} aria-hidden="true" />
        <span>{kept ? "Kept" : "Keep run"}</span>
      </button>
      {history.runs.length ? (
        <ul className="lab-runs-list">
          {history.runs.map((entry) => {
            const id = entry.run.id;
            const live = id === run.id;
            const differences = inputDifferences(entry.run.inputs, run.inputs);
            const shown = live ? colour : colourOf.get(id);
            const label = live ? "This run" : runLabel(differences);
            return (
              <li
                key={id}
                className="lab-runs-item"
                data-on={shown ? "" : undefined}
              >
                <button
                  type="button"
                  className="lab-runs-toggle"
                  aria-pressed={Boolean(shown)}
                  disabled={live || entry.pinned || (!shown && full)}
                  onClick={() => history.onToggle(id)}
                  title={[
                    live
                      ? "The live run"
                      : entry.pinned
                        ? "The baseline, always overlaid"
                        : !shown && full
                          ? `Up to ${COMPARE_LIMIT} series at once`
                          : "Overlay on the plot",
                    ...differences,
                    `Run ${id.slice(7, 19)}`,
                  ].join("\n")}
                >
                  <i
                    className="lab-plot-swatch"
                    style={{ background: shown ?? "transparent" }}
                    aria-hidden="true"
                  />
                  {entry.pinned ? <small>Baseline · </small> : null}
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="px-icon-button"
                  aria-pressed={entry.pinned}
                  aria-label={
                    entry.pinned ? "Unpin baseline" : "Pin as baseline"
                  }
                  title={entry.pinned ? "Unpin baseline" : "Pin as baseline"}
                  onClick={() => history.onPin(id)}
                >
                  <Pin size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="px-icon-button"
                  aria-label="Re-run and check"
                  title="Re-run and check: repeat this run and compare it sample by sample"
                  disabled={history.checking === id}
                  onClick={() => history.onRecheck(entry.run)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="px-icon-button"
                  aria-label="Remove run"
                  title="Remove from the history"
                  onClick={() => history.onRemove(id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="lab-note">Finished runs are kept here.</span>
      )}
    </div>
  );
}

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
  /** Stored runs to compare with the live one. */
  history?: RunHistoryControls;
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
  history,
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
  const colour = seriesColour(scene, target);
  const compared = history && run ? runOverlays(history, run, colour) : [];
  const overlays: PlotOverlay[] = compared.flatMap(
    ({ entry, color, label }) => {
      const values = quantity && entry.run.series.columns[quantity.key];
      return values ? [{ label, color, t: entry.run.series.t, values }] : [];
    },
  );

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
      {history && run && view === "plot" ? (
        <RunChips
          history={history}
          run={run}
          colour={colour}
          overlays={compared}
        />
      ) : null}
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
                color: colour,
                t: run.series.t,
                values: run.series.columns[quantity.key],
              }}
              curve={curve}
              domain={Math.max(
                run.stop.t,
                ...compared.map(({ entry }) => entry.run.stop.t),
              )}
              until={time}
              overlays={overlays}
              keys={overlays.length ? { series: "This run" } : undefined}
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
