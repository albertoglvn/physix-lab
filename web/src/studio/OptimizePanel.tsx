/**
 * Bounded geometry search through the local API. The service screens candidates with the
 * surrogate, then FEM-checks the baseline and the best designs before calling a result a
 * verified improvement.
 */

import { useMemo, useState } from "react";
import {
  api,
  ApiError,
  type Design,
  type OptimizeResponse,
  type OptimizeVariable,
} from "../api/client";
import type { Case } from "../physics/case";
import { yieldStrength } from "../physics/case";
import { NumField, Segmented, Spinner, Stat } from "../ui/controls";
import { FieldView } from "../ui/FieldView";
import { mm, mpa, ms, pct } from "../ui/units";

interface Candidate {
  path: string;
  label: string;
  value: number;
  min: number;
  max: number;
}

export function candidateVariables(c: Case): Candidate[] {
  const g = c.geometry;
  const w = g.width;
  const out: Candidate[] = [];
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo), hi);
  g.holes.forEach((h, i) => {
    out.push({
      path: `geometry.holes[${i}].radius`,
      label: `Hole ${i + 1} radius`,
      value: h.radius,
      min: 0.6 * h.radius,
      max: 1.4 * h.radius,
    });
    out.push({
      path: `geometry.holes[${i}].x`,
      label: `Hole ${i + 1} x`,
      value: h.x,
      min: clamp(h.x - 0.15 * w, 0, w),
      max: clamp(h.x + 0.15 * w, 0, w),
    });
    out.push({
      path: `geometry.holes[${i}].y`,
      label: `Hole ${i + 1} y`,
      value: h.y,
      min: clamp(h.y - 0.1 * w, 0, g.height),
      max: clamp(h.y + 0.1 * w, 0, g.height),
    });
  });
  if (c.family === "bracket") {
    const a = g.web_width ?? 0;
    const b = g.flange_height ?? 0;
    const r = g.fillet_radius ?? 0;
    out.push({
      path: "geometry.web_width",
      label: "Web width",
      value: a,
      min: 0.75 * a,
      max: 1.4 * a,
    });
    out.push({
      path: "geometry.flange_height",
      label: "Flange height",
      value: b,
      min: 0.75 * b,
      max: 1.3 * b,
    });
    out.push({
      path: "geometry.fillet_radius",
      label: "Fillet radius",
      value: r,
      min: Math.max(0.5 * r, 0.002 * w),
      max: Math.max(2.5 * r, 0.01 * w),
    });
  }
  return out;
}

type Objective = "min_max_von_mises" | "min_volume";

function Trace({ data }: { data: OptimizeResponse }) {
  const pts = data.search.trace.filter((t) => Number.isFinite(t.objective));
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p.objective);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const W = 600;
  const H = 120;
  const X = (k: number) => 8 + (k / (pts.length - 1)) * (W - 16);
  const Y = (v: number) => H - 10 - ((v - lo) / (hi - lo || 1)) * (H - 20);
  const segments: string[] = [];
  let best = Infinity;
  for (let k = 0; k < pts.length; k++) {
    if (pts[k].feasible) best = Math.min(best, pts[k].objective);
    if (Number.isFinite(best))
      segments.push(`${segments.length === 0 ? "M" : "L"} ${X(k)} ${Y(best)}`);
  }
  const bestPath = segments.join(" ");
  const screen = pts.findIndex((p) => p.stage === "refine");
  return (
    <svg
      className="trace"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Search trace"
    >
      {screen > 0 && (
        <line
          x1={X(screen)}
          x2={X(screen)}
          y1={4}
          y2={H - 4}
          className="trace-split"
        />
      )}
      {pts.map((p, k) => (
        <circle
          key={k}
          cx={X(k)}
          cy={Y(p.objective)}
          r={2.4}
          className={p.feasible ? "trace-ok" : "trace-bad"}
        />
      ))}
      <path d={bestPath} className="trace-best" />
      {screen > 0 && (
        <>
          <text x={X(0) + 4} y={14} className="trace-label">
            Latin-hypercube screening
          </text>
          <text x={X(screen) + 4} y={14} className="trace-label">
            pattern search
          </text>
        </>
      )}
    </svg>
  );
}

function DesignCard({
  title,
  d,
  objective,
  tone,
}: {
  title: string;
  d: Design;
  objective: Objective;
  tone: "neutral" | "ok";
}) {
  return (
    <div className={`design-card tone-${tone}`}>
      <h4>{title}</h4>
      <dl>
        <dt>FEM peak von Mises</dt>
        <dd>{mpa(d.fem.hotspot_von_mises)}</dd>
        <dt>Safety factor</dt>
        <dd>
          {d.fem.safety_factor != null ? d.fem.safety_factor.toFixed(2) : "—"}
        </dd>
        <dt>Area × thickness</dt>
        <dd>{(d.fem.volume * 1e6).toFixed(2)} cm³</dd>
        <dt>Objective</dt>
        <dd>
          {objective === "min_volume"
            ? `${(d.fem.objective * 1e6).toFixed(2)} cm³`
            : mpa(d.fem.objective)}
        </dd>
        <dt>Feasible</dt>
        <dd>{d.fem.feasible ? "yes" : d.fem.violations.join(", ") || "no"}</dd>
      </dl>
      <ul className="vars">
        {Object.entries(d.variables).map(([k, v]) => (
          <li key={k}>
            <code>{k.replace("geometry.", "")}</code> {mm(v)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OptimizePanel({
  c,
  online,
  onApply,
}: {
  c: Case;
  online: boolean;
  onApply: (c: Case) => void;
}) {
  const candidates = useMemo(() => candidateVariables(c), [c]);
  const shape = candidates.map((v) => v.path).join("|");
  const [chosen, setChosen] = useState<
    Record<string, { on: boolean; min: number; max: number }>
  >({});
  const [objective, setObjective] = useState<Objective>("min_max_von_mises");
  const [minSf, setMinSf] = useState(2);
  const [budget, setBudget] = useState(80);
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    data: OptimizeResponse;
    forCase: string;
  } | null>(null);
  const named = yieldStrength(c) != null;
  const key = JSON.stringify(c);

  const entry = (v: Candidate, k: number) =>
    chosen[`${shape}::${v.path}`] ?? { on: k < 2, min: v.min, max: v.max };
  const set = (
    v: Candidate,
    k: number,
    patch: Partial<{ on: boolean; min: number; max: number }>,
  ) =>
    setChosen((s) => ({
      ...s,
      [`${shape}::${v.path}`]: { ...entry(v, k), ...patch },
    }));

  const variables: OptimizeVariable[] = candidates
    .map((v, k) => ({ v, e: entry(v, k) }))
    .filter(({ e }) => e.on)
    .map(({ v, e }) => ({ path: v.path, min: e.min, max: e.max }));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const constraints: Record<string, number> = {};
      if (named && minSf > 0) constraints.min_safety_factor = minSf;
      const data = await api.optimize({
        case: c,
        variables,
        objective,
        constraints,
        budget,
        seed,
      });
      setResult({ data, forCase: key });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const data = result?.data;
  const sel = data?.selected;
  const stale = result && result.forCase !== key;

  return (
    <div className="panel-body">
      <div className="panel-intro">
        <p>
          Search only the variables and bounds you choose. Candidates are
          screened with the surrogate (or the fast FEM mesh outside its domain);
          the baseline and the best designs are then re-solved with FEM.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!online || busy || variables.length === 0}
          onClick={start}
        >
          {busy ? <Spinner label="Searching…" /> : "Optimise"}
        </button>
      </div>
      {!online && (
        <p className="callout tone-warn">
          Optimisation runs in the local API. Start it with{" "}
          <code>make serve</code>.
        </p>
      )}
      {error && <p className="callout tone-bad">{error}</p>}

      <div className="opt-grid">
        <div>
          <h4 className="eyebrow">Variables and bounds</h4>
          {candidates.length === 0 && (
            <p className="muted small">
              Add a hole or switch to a bracket to get design variables.
            </p>
          )}
          <div className="var-list">
            {candidates.map((v, k) => {
              const e = entry(v, k);
              return (
                <div key={v.path} className={`var-row ${e.on ? "is-on" : ""}`}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={e.on}
                      onChange={(ev) => set(v, k, { on: ev.target.checked })}
                    />
                    <span>{v.label}</span>
                    <small className="muted">now {mm(v.value)}</small>
                  </label>
                  <NumField
                    label="min"
                    unit="mm"
                    scale={1e3}
                    value={e.min}
                    onChange={(x) => set(v, k, { min: x })}
                  />
                  <NumField
                    label="max"
                    unit="mm"
                    scale={1e3}
                    value={e.max}
                    onChange={(x) => set(v, k, { max: x })}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h4 className="eyebrow">Objective and constraints</h4>
          <Segmented<Objective>
            label="Objective"
            value={objective}
            onChange={setObjective}
            options={[
              { value: "min_max_von_mises", label: "Lower peak stress" },
              { value: "min_volume", label: "Lighter part" },
            ]}
          />
          <div className="grid2 mt">
            <NumField
              label="Min safety factor"
              value={minSf}
              step={0.1}
              onChange={setMinSf}
              hint={
                named ? "Yield / FEM peak von Mises" : "Needs a named material"
              }
            />
            <NumField
              label="Budget"
              value={budget}
              step={10}
              onChange={(v) =>
                setBudget(Math.round(Math.min(Math.max(v, 8), 400)))
              }
              hint="Surrogate evaluations (8–400)"
            />
            <NumField
              label="Seed"
              value={seed}
              step={1}
              onChange={(v) => setSeed(Math.round(v))}
            />
          </div>
          {!named && (
            <p className="muted small">
              Pick a named material to enable the safety-factor constraint.
            </p>
          )}
          {objective === "min_volume" && !named && (
            <p className="callout tone-warn small">
              Lighter-part search needs a safety-factor constraint.
            </p>
          )}
        </div>
      </div>

      {data && (
        <div className="opt-result">
          {stale && (
            <p className="callout tone-warn">
              The case changed after this search.
            </p>
          )}
          <div className="stat-row">
            <Stat
              label="Verified improvement"
              value={data.verified_improvement ? "Yes" : "No"}
              tone={data.verified_improvement ? "ok" : "warn"}
              sub={
                data.verified_improvement
                  ? "FEM-checked baseline and selection"
                  : data.feasible_found
                    ? "no FEM-better design found"
                    : "no feasible design found"
              }
            />
            <Stat
              label="Objective change"
              value={
                data.improvement ? pct(data.improvement.relative_change) : "—"
              }
              sub="FEM, selected vs baseline"
              tone={
                data.improvement && data.improvement.relative_change < 0
                  ? "ok"
                  : undefined
              }
            />
            <Stat
              label="Evaluations"
              value={data.search.evaluations}
              sub={Object.entries(data.search.estimators)
                .map(([k, v]) => `${v} ${k}`)
                .join(" · ")}
            />
            <Stat
              label="Wall time"
              value={ms(data.timing.total_ms)}
              sub={`seed ${data.search.seed}`}
            />
          </div>
          <Trace data={data} />
          <div className="design-pair">
            <DesignCard
              title="Baseline (FEM)"
              d={data.baseline}
              objective={objective}
              tone="neutral"
            />
            {sel ? (
              <DesignCard
                title="Selected (FEM)"
                d={sel}
                objective={objective}
                tone="ok"
              />
            ) : (
              <div className="placeholder">No feasible candidate.</div>
            )}
            {sel && (
              <div className="design-preview">
                <FieldView
                  c={sel.case}
                  ghost={data.baseline.case}
                  values={null}
                  mask={null}
                  range={{ min: 0, max: 1 }}
                  colormap="stress"
                  ariaLabel="Selected geometry over the baseline outline"
                />
                <p className="muted small">
                  Selected outline, with the baseline dashed.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onApply(sel.case)}
                >
                  Apply selected design
                </button>
              </div>
            )}
          </div>
          {data.candidates_verified.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Surrogate estimate</th>
                  <th>FEM peak</th>
                  <th>Estimate error</th>
                  <th>Safety factor</th>
                  <th>Feasible</th>
                </tr>
              </thead>
              <tbody>
                {data.candidates_verified.map((d, k) => (
                  <tr
                    key={k}
                    className={
                      sel &&
                      JSON.stringify(d.variables) ===
                        JSON.stringify(sel.variables)
                        ? "is-selected"
                        : ""
                    }
                  >
                    <td>#{k + 1}</td>
                    <td>
                      {typeof d.estimate.hotspot_von_mises === "number"
                        ? mpa(d.estimate.hotspot_von_mises)
                        : "—"}
                    </td>
                    <td>{mpa(d.fem.hotspot_von_mises)}</td>
                    <td>{pct(d.fem.estimate_error)}</td>
                    <td>
                      {d.fem.safety_factor != null
                        ? d.fem.safety_factor.toFixed(2)
                        : "—"}
                    </td>
                    <td>{d.fem.feasible ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
