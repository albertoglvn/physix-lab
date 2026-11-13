import { Copy, Download, Play, Square } from "lucide-react";
import { useRef, useState } from "react";
import {
  api,
  ApiError,
  type ConvergenceResponse,
  type MeshPreset,
} from "../../api/client";
import type { Case } from "../../physics/case";
import { Badge, Stat } from "../../ui/controls";
import { mm, mpa, ms, pct } from "../../ui/units";
import { toasts } from "../ui/toastStore";
import {
  convergenceMethods,
  KIND_LABELS,
  PRESET_LABELS,
  promotedLevel,
} from "./convergence";
import { StudyPlot, type StudyLine, type StudyMark } from "./StudyPlot";

const PROBE_COLOURS = [
  "var(--px-series-2)",
  "var(--px-series-3)",
  "var(--px-series-4)",
];

export type ConvergenceRun = {
  forCase: string;
  data: ConvergenceResponse;
  /** Whether FEM checks of this case use the promoted mesh. */
  adopted: boolean;
};

/** Study state kept by the Stress study, so closing the sheet keeps the result. */
export function useConvergence() {
  const [run, setRun] = useState<ConvergenceRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = async (c: Case, probes: { x: number; y: number }[]) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const data = await api.convergence(c, { probes }, controller.signal);
      setRun({ forCase: JSON.stringify(c), data, adopted: !!data.promoted });
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setBusy(false);
  };

  const adopt = (adopted: boolean) =>
    setRun((current) => (current ? { ...current, adopted } : current));

  return { run, busy, error, start, cancel, adopt };
}

export type ConvergenceState = ReturnType<typeof useConvergence>;

/** The mesh FEM checks of `c` should use: the promoted level while it is adopted. */
export function referencePreset(
  run: ConvergenceRun | null,
  c: Case,
): MeshPreset | undefined {
  return run && run.adopted && run.forCase === JSON.stringify(c)
    ? (run.data.promoted ?? undefined)
    : undefined;
}

export function hotspotPlot(study: ConvergenceResponse) {
  const levels = study.levels;
  const coarse = levels[0].element_size * 1e3;
  const fine = levels[levels.length - 1];
  const fit = study.hotspot;
  const marks: StudyMark[] = levels.map((level) => ({
    x: level.element_size * 1e3,
    y: level.hotspot.von_mises / 1e6,
    color: "var(--px-series-1)",
  }));
  const lines: StudyLine[] = [
    {
      points: levels.map((level) => [
        level.element_size * 1e3,
        level.hotspot.von_mises / 1e6,
      ]),
      color: "var(--px-series-1)",
    },
  ];
  if (fit.extrapolated !== null)
    lines.push({
      points: [
        [0, fit.extrapolated / 1e6],
        [coarse, fit.extrapolated / 1e6],
      ],
      color: "var(--px-ref)",
      dashed: true,
    });
  const value = fine.hotspot.von_mises / 1e6;
  const band = {
    x0: 0,
    x1: fine.element_size * 1e3,
    low: value * (1 - fit.gci_fine),
    high: value * (1 + fit.gci_fine),
    color: "var(--px-series-1)",
  };
  return { marks, lines, band, domain: [0, coarse] as [number, number] };
}

export type ConvergenceSheetProps = {
  c: Case;
  state: ConvergenceState;
  probes: { x: number; y: number }[];
  probeLabel: string;
  online: boolean;
  onExport: (study: ConvergenceResponse) => void;
};

/**
 * The convergence study sheet: three mesh levels, the hotspot and probes against element
 * size, Richardson extrapolation and the GCI, and the finest passing level promoted as the
 * reference for FEM checks of this part.
 */
export function ConvergenceSheet({
  c,
  state,
  probes,
  probeLabel,
  online,
  onExport,
}: ConvergenceSheetProps) {
  const run = state.run;
  const study = run?.data;
  const stale = run && run.forCase !== JSON.stringify(c);
  const fit = study?.hotspot;
  const promoted = study ? promotedLevel(study) : undefined;
  const plot = study ? hotspotPlot(study) : null;

  return (
    <div className="lab-stress-study">
      <p className="lab-sheet-lead">
        Solves this part on coarse, medium and fine meshes and compares each
        level with the next. A level passes when refining changes the hotspot
        and the stress field by at most 2%; the fine level passes when its grid
        convergence index is within 2%. The finest passing level becomes the
        reference mesh for FEM checks of this part.
      </p>
      <p className="lab-note">
        {probes.length
          ? `Probes: ${probes.length} ${probes.length === 1 ? "point" : "points"} along the ${probeLabel}.`
          : `No probe points: the ${probeLabel} has no point clear of the boundary.`}
      </p>
      <div className="lab-sheet-actions">
        {state.busy ? (
          <button type="button" className="lab-button" onClick={state.cancel}>
            <Square size={15} aria-hidden="true" /> Stop
          </button>
        ) : null}
        <button
          type="button"
          className="lab-button lab-button--dark"
          disabled={!online || state.busy}
          title={online ? undefined : "The FEM solver is unavailable"}
          onClick={() => void state.start(c, probes)}
        >
          <Play size={15} aria-hidden="true" />
          {state.busy ? "Solving three meshes…" : "Run study"}
        </button>
      </div>
      {state.error ? (
        <p className="lab-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {study && fit && plot ? (
        <section className="lab-stress-results" aria-label="Convergence study">
          {stale ? (
            <p className="lab-note">
              The part changed since this study; it shows the part as it was,
              and FEM checks use the default mesh.
            </p>
          ) : null}
          <div className="stat-row">
            <Stat
              label="Convergence"
              value={KIND_LABELS[fit.kind]}
              sub={
                fit.order !== null
                  ? `observed order ${fit.order.toPrecision(3)}`
                  : "order undefined"
              }
            />
            <Stat
              label="Richardson limit"
              value={mpa(fit.extrapolated)}
              sub={
                fit.order_used !== null && fit.extrapolated !== null
                  ? `order ${Number(fit.order_used.toPrecision(3))} used`
                  : "not extrapolated"
              }
            />
            <Stat
              label="GCI, fine mesh"
              value={pct(fit.gci_fine, 2)}
              sub={`safety factor ${fit.safety_factor}`}
            />
            <Stat
              label="Reference mesh"
              value={promoted ? PRESET_LABELS[promoted.preset] : "None"}
              sub={
                promoted
                  ? `${promoted.nodes} nodes · ${mpa(promoted.hotspot.von_mises)}`
                  : "no level met the tolerances"
              }
            />
          </div>
          <StudyPlot
            marks={plot.marks}
            lines={plot.lines}
            band={plot.band}
            domain={plot.domain}
            xAxis={{ label: "Element size", symbol: "h", unit: "mm" }}
            yAxis={{ label: "Hotspot von Mises", symbol: "σ", unit: "MPa" }}
            keys={[
              { label: "FEM level", color: "var(--px-series-1)" },
              ...(fit.extrapolated !== null
                ? [{ label: "Richardson limit", color: "var(--px-ref)" }]
                : []),
              {
                label: "GCI band on the fine value",
                color: "var(--px-series-1)",
                hollow: true,
              },
            ]}
            label={`Hotspot von Mises stress against element size at three mesh levels${fit.extrapolated !== null ? ", with the Richardson limit" : ""}`}
          />
          {study.probes.length ? (
            <StudyPlot
              marks={study.levels.flatMap((level) =>
                study.probes.map((_, k) => ({
                  x: level.element_size * 1e3,
                  y: level.probes[k] / 1e6,
                  color: PROBE_COLOURS[k % PROBE_COLOURS.length],
                })),
              )}
              lines={study.probes.map((_, k) => ({
                points: study.levels.map(
                  (level) =>
                    [level.element_size * 1e3, level.probes[k] / 1e6] as [
                      number,
                      number,
                    ],
                ),
                color: PROBE_COLOURS[k % PROBE_COLOURS.length],
              }))}
              domain={plot.domain}
              xAxis={{ label: "Element size", symbol: "h", unit: "mm" }}
              yAxis={{ label: "Probe von Mises", symbol: "σ", unit: "MPa" }}
              keys={study.probes.map((probe, k) => ({
                label: `Probe ${k + 1} at ${mm(probe.x)}, ${mm(probe.y)} · GCI ${pct(probe.gci_fine, 2)}`,
                color: PROBE_COLOURS[k % PROBE_COLOURS.length],
              }))}
              label={`Von Mises stress at ${study.probes.length} probes against element size`}
            />
          ) : null}
          <div className="lab-table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th scope="col">Mesh</th>
                  <th scope="col">Nodes</th>
                  <th scope="col">Elements</th>
                  <th scope="col">h</th>
                  <th scope="col">Hotspot</th>
                  <th scope="col">Hotspot change</th>
                  <th scope="col">Field change</th>
                  <th scope="col">Solve</th>
                  <th scope="col">Passes</th>
                </tr>
              </thead>
              <tbody>
                {study.levels.map((level) => (
                  <tr key={level.preset}>
                    <td>{PRESET_LABELS[level.preset]}</td>
                    <td>{level.nodes}</td>
                    <td>{level.elements}</td>
                    <td>{mm(level.element_size)}</td>
                    <td>{mpa(level.hotspot.von_mises)}</td>
                    <td>
                      {level.to_finer
                        ? pct(level.to_finer.hotspot_rel, 2)
                        : "—"}
                    </td>
                    <td>
                      {level.to_finer
                        ? pct(level.to_finer.field_rel_l2, 2)
                        : `GCI ${pct(fit.gci_fine, 2)}`}
                    </td>
                    <td>{ms(level.solve_ms)}</td>
                    <td>
                      {level.passes ? (
                        <Badge tone="ok">Yes</Badge>
                      ) : (
                        <Badge tone="warn">No</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lab-note">
            Changes are to the next finer mesh. h is the square root of the
            solid area per element. {study.hotspot_rule}. Source: FEM (
            {study.solver.name} {study.solver.version}),{" "}
            {ms(study.timing.total_ms)} for three solves;{" "}
            {study.timing.boundary}.
          </p>
          {promoted && !stale ? (
            <label className="lab-toggle">
              <input
                type="checkbox"
                checked={run.adopted}
                onChange={(event) => state.adopt(event.currentTarget.checked)}
              />
              <span>
                Use the {PRESET_LABELS[promoted.preset].toLowerCase()} mesh for
                FEM checks of this part
              </span>
            </label>
          ) : null}
          <div className="lab-sheet-actions">
            <button
              type="button"
              className="lab-button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(convergenceMethods(study))
                  .then(() =>
                    toasts.push({
                      tone: "ok",
                      message: "Copied the methods text.",
                    }),
                  );
              }}
            >
              <Copy size={15} aria-hidden="true" /> Copy methods
            </button>
            <button
              type="button"
              className="lab-button"
              onClick={() => onExport(study)}
            >
              <Download size={15} aria-hidden="true" /> Export CSV
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
