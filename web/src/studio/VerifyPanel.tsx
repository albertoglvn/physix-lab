/**
 * Solve the identical case with scikit-fem through the local API and compare it with the
 * surrogate that is on screen: same grid, same mask, same units, same colour range.
 */

import { useImperativeHandle, useMemo, useState, type Ref } from "react";
import {
  api,
  ApiError,
  fieldComponent,
  type VerifyResponse,
} from "../api/client";
import type { SurrogatePrediction } from "../inference/engine";
import { compareFields } from "../lab/stress/compare";
import type { Case } from "../physics/case";
import { solidMask } from "../physics/encoding";
import { Badge, Spinner, Stat } from "../ui/controls";
import { Colorbar, FieldView } from "../ui/FieldView";
import { MeshView } from "../ui/MeshView";
import { fieldRange } from "../ui/colormap";
import { mm, mpa, ms, newtons, pct, ratio } from "../ui/units";

/** Lets the lab start a check from its top bar. */
export type VerifyHandle = { start: () => void };

/** A finished check and the case it solved, as `JSON.stringify(case)`. */
export type VerifyRun = { forCase: string; data: VerifyResponse };

interface Run {
  forCase: string;
  data: VerifyResponse;
  prediction: SurrogatePrediction | null;
}

export function VerifyPanel({
  c,
  pred,
  online,
  browser,
  onInvalid,
  onResult,
  ref,
}: {
  c: Case;
  pred: SurrogatePrediction | null;
  online: boolean;
  browser: boolean;
  onInvalid: (field: string | null) => void;
  /** Called with each finished check, so the lab can reuse the solver field. */
  onResult?: (run: VerifyRun) => void;
  ref?: Ref<VerifyHandle>;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"field" | "mesh">("field");
  const key = JSON.stringify(c);
  const stale = run && run.forCase !== key;

  const start = async () => {
    setBusy(true);
    setError(null);
    onInvalid(null);
    try {
      const data = await api.verify(c, {
        include_field: true,
        include_mesh: true,
      });
      setRun({
        forCase: key,
        data,
        prediction: pred,
      });
      onResult?.({ forCase: key, data });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        onInvalid(err.field ?? null);
      } else setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    start: () => {
      if (online && !busy) void start();
    },
  }));

  const fem = run?.data;
  const mask = useMemo(
    () => (fem ? solidMask(JSON.parse(run.forCase) as Case) : null),
    [fem, run],
  );
  const runCase = useMemo(
    () => (run ? (JSON.parse(run.forCase) as Case) : null),
    [run],
  );
  const femVm = useMemo(
    () => (fem?.field ? fieldComponent(fem.field, "von_mises") : null),
    [fem],
  );
  const comparedPrediction = run?.prediction ?? (stale ? null : pred);
  const surVm = comparedPrediction?.result.vonMises ?? null;

  const range = useMemo(() => {
    const a = femVm ? fieldRange(femVm, mask) : { min: 0, max: 1 };
    const b = surVm ? fieldRange(surVm, mask) : a;
    return { min: 0, max: Math.max(a.max, b.max) };
  }, [femVm, surVm, mask]);

  const comparison = useMemo(
    () => (femVm && surVm && mask ? compareFields(surVm, femVm, mask) : null),
    [femVm, surVm, mask],
  );
  const errorMap = comparison
    ? {
        values: comparison.diff,
        range: {
          min: -(comparison.maxAbsRel || 1),
          max: comparison.maxAbsRel || 1,
        },
      }
    : null;

  const rasterRef = fem?.summary.raster_hotspot?.von_mises;
  const browserHotspot = comparedPrediction?.result.hotspot.von_mises ?? null;
  const browserMs = comparedPrediction?.timing.total_ms ?? null;
  const hotErr =
    browserHotspot != null && rasterRef
      ? Math.abs(browserHotspot - rasterRef) / rasterRef
      : null;
  const femMs = fem?.timing.total_ms ?? null;
  const speedup = femMs && browserMs ? femMs / browserMs : null;
  const disc = fem?.discrepancy.surrogate;

  return (
    <div className="panel-body">
      <div className="panel-intro">
        <p>
          Solves the identical case with <strong>scikit-fem</strong> (quadratic
          triangles) and compares it with the surrogate on the same 64 × 128
          grid and mask. The solver is the source of truth.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!online || busy}
          onClick={start}
        >
          {busy ? (
            <Spinner label="Solving…" />
          ) : run ? (
            "Re-run FEM check"
          ) : (
            "Run FEM check"
          )}
        </button>
      </div>
      {browser && online && !run && !error && (
        <p className="muted small">
          The first check loads the solver. The case and results stay in this
          tab.
        </p>
      )}
      {!online && (
        <p className="callout tone-warn">
          {browser ? (
            "FEM verification needs a browser with WebAssembly and worker support."
          ) : (
            <>
              Start the local solver with <code>make serve</code> to run FEM
              checks and optimisation.
            </>
          )}
        </p>
      )}
      {error && <p className="callout tone-bad">{error}</p>}
      {stale && (
        <p className="callout tone-warn">
          The case changed after this check. Re-run it to compare the current
          design.
        </p>
      )}
      {fem && runCase && (
        <>
          <div className="stat-row">
            <Stat
              label="FEM peak von Mises"
              value={mpa(fem.summary.hotspot.von_mises)}
              sub={`mesh nodes · at ${mm(fem.summary.hotspot.x)}, ${mm(fem.summary.hotspot.y)}`}
            />
            <Stat
              label="FEM on the model grid"
              value={mpa(rasterRef)}
              sub="like-for-like reference"
            />
            <Stat
              label="Surrogate peak"
              value={mpa(browserHotspot)}
              sub={
                hotErr != null
                  ? `${pct(hotErr)} vs grid reference`
                  : "no browser prediction"
              }
              tone={
                hotErr == null
                  ? undefined
                  : hotErr <= 0.1
                    ? "ok"
                    : hotErr <= 0.25
                      ? "warn"
                      : "bad"
              }
            />
            <Stat
              label="Masked RMSE"
              value={mpa(comparison?.rmse)}
              sub={
                comparison
                  ? `${pct(comparison.rmseRel)} of FEM peak · ${comparison.count.toLocaleString()} px`
                  : "no browser prediction"
              }
              title="Root-mean-square von Mises difference over the solid mask, against FEM on the same grid"
            />
            <Stat
              label="Speed-up"
              value={ratio(speedup, 0)}
              sub={`${ms(browserMs)} browser vs ${ms(femMs)} FEM`}
              tone="accent"
            />
          </div>

          <div className="compare">
            <figure>
              <figcaption>
                <Badge tone="accent">Surrogate</Badge> ensemble mean, in this
                browser
              </figcaption>
              <FieldView
                c={runCase}
                values={surVm}
                mask={mask}
                range={range}
                colormap="stress"
                formatValue={(v) => mpa(v)}
                markers={
                  pred && !stale
                    ? [{ x: pred.result.hotspot.x, y: pred.result.hotspot.y }]
                    : []
                }
              />
            </figure>
            <figure>
              <figcaption>
                <Badge tone="ok">FEM</Badge> {fem.solver?.name}{" "}
                {fem.solver?.version}, {fem.solver?.mesh_preset} mesh
                <span className="seg-inline">
                  <button
                    type="button"
                    className={view === "field" ? "is-on" : ""}
                    onClick={() => setView("field")}
                  >
                    grid
                  </button>
                  <button
                    type="button"
                    className={view === "mesh" ? "is-on" : ""}
                    onClick={() => setView("mesh")}
                  >
                    mesh
                  </button>
                </span>
              </figcaption>
              {view === "mesh" && fem.mesh ? (
                <MeshView mesh={fem.mesh} range={range} />
              ) : (
                <FieldView
                  c={runCase}
                  values={femVm}
                  mask={mask}
                  range={range}
                  colormap="stress"
                  formatValue={(v) => mpa(v)}
                  markers={[
                    {
                      x: fem.summary.hotspot.x,
                      y: fem.summary.hotspot.y,
                      tone: "ref",
                    },
                  ]}
                />
              )}
            </figure>
            <figure>
              <figcaption>
                <Badge>Error</Badge> (surrogate − FEM) / FEM peak
              </figcaption>
              {errorMap ? (
                <FieldView
                  c={runCase}
                  values={errorMap.values}
                  mask={mask}
                  range={errorMap.range}
                  colormap="diverging"
                  formatValue={(v) => pct(v)}
                  showLoads={false}
                />
              ) : (
                <div className="placeholder">
                  Needs a browser prediction of the same case.
                </div>
              )}
            </figure>
          </div>
          <div className="compare-bars">
            <Colorbar
              range={range}
              colormap="stress"
              label="von Mises"
              format={(v) => mpa(v)}
            />
            {errorMap && (
              <Colorbar
                range={errorMap.range}
                colormap="diverging"
                label="Signed error"
                format={(v) => pct(v, 0)}
              />
            )}
          </div>

          <div
            className="stress-table-scroll"
            role="region"
            aria-label="FEM solver details"
            tabIndex={0}
          >
            <table className="kv">
              <tbody>
                <tr>
                  <th>Mesh</th>
                  <td>
                    {fem.solver?.nodes.toLocaleString()} nodes,{" "}
                    {fem.solver?.elements.toLocaleString()}{" "}
                    {fem.solver?.element} elements
                  </td>
                  <th>Equilibrium residual</th>
                  <td>
                    {fem.summary.equilibrium_residual != null
                      ? fem.summary.equilibrium_residual.toExponential(1)
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <th>Reaction</th>
                  <td>
                    {fem.summary.reaction_force
                      ? `${newtons(fem.summary.reaction_force[0])}, ${newtons(fem.summary.reaction_force[1])}`
                      : "—"}
                  </td>
                  <th>Max displacement</th>
                  <td>
                    {fem.summary.max_displacement != null
                      ? mm(fem.summary.max_displacement, 3)
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <th>Safety factor (FEM)</th>
                  <td>
                    {fem.summary.safety_factor != null
                      ? fem.summary.safety_factor.toFixed(2)
                      : "needs a named material"}
                  </td>
                  <th>Stress concentration</th>
                  <td>
                    {fem.summary.stress_concentration != null
                      ? fem.summary.stress_concentration.toFixed(2)
                      : "—"}
                  </td>
                </tr>
                {disc && (
                  <tr>
                    <th>Service surrogate</th>
                    <td>
                      hotspot error {pct(disc.hotspot_error)}, von Mises rel. L2{" "}
                      {pct(disc.von_mises_rel_l2)}
                    </td>
                    <th>Fallback verdict</th>
                    <td>
                      {disc.would_fallback
                        ? "would fall back to FEM"
                        : "accepted"}
                    </td>
                  </tr>
                )}
                <tr>
                  <th>Case id</th>
                  <td colSpan={3}>
                    <code>{fem.case_id}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">
            The mesh peak is evaluated at FE nodes; the grid reference samples
            the same FEM field at pixel centres, which is what the surrogate
            predicts, so grid-to-grid is the like-for-like comparison. Errors
            here are against the solver; the ensemble disagreement in Results is
            the spread between models and is not an error. Timings: browser time
            is the full in-tab inference (encode, every member, statistics). FEM
            time covers the solve and post-processing and excludes
            {browser ? " solver startup." : " HTTP transport."}
          </p>
        </>
      )}
    </div>
  );
}
