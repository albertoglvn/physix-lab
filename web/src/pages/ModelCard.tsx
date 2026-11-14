/** The model card: provenance, evaluation against FEM, fallback calibration and domain. */

import { useEffect, useState } from "react";
import type { ModelManifest } from "../inference/engine";
import { useEngine, type Health } from "../state";
import { Badge, Spinner } from "../ui/controls";
import { asSentence, ms, pct } from "../ui/units";

const METRIC_LABELS: Record<string, string> = {
  hotspot_error: "Peak von Mises error (grid basis)",
  von_mises_rel_l2: "von Mises relative L2 over the part",
  component_rel_l2: "Stress components relative L2",
  hotspot_location_error_rel: "Peak location error / width",
  disagreement: "Ensemble disagreement",
  raster_bias: "Grid peak / mesh peak (FEM)",
};

type Dist = { mean: number; median: number; p90: number; max: number };
const isDist = (v: unknown): v is Dist =>
  typeof v === "object" && v !== null && "median" in v;

function EvaluationTable({ m }: { m: ModelManifest }) {
  const splits = m.evaluation?.splits ?? {};
  const names = Object.keys(splits);
  const metrics = Object.keys(METRIC_LABELS).filter((k) =>
    names.some((s) => isDist(splits[s][k])),
  );
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Metric (median · p90)</th>
          {names.map((s) => (
            <th key={s}>
              {s} <span className="muted">n={splits[s].cases}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {metrics.map((k) => (
          <tr key={k}>
            <td>{METRIC_LABELS[k]}</td>
            {names.map((s) => {
              const v = splits[s][k];
              return (
                <td key={s} className="mono">
                  {isDist(v)
                    ? k === "raster_bias"
                      ? `${v.median.toFixed(3)} · ${v.p90.toFixed(3)}`
                      : `${pct(v.median)} · ${pct(v.p90)}`
                    : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Range({
  r,
  scale = 1,
  unit = "",
}: {
  r?: [number, number];
  scale?: number;
  unit?: string;
}) {
  if (!r) return <>—</>;
  return (
    <span className="mono">
      {+(r[0] * scale).toPrecision(3)} – {+(r[1] * scale).toPrecision(3)}
      {unit}
    </span>
  );
}

export function ModelCard({ health }: { health: Health }) {
  const engine = useEngine();
  const [manifest, setManifest] = useState<ModelManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("models/manifest.json", { cache: "no-cache" })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<ModelManifest>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then(setManifest)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  if (error)
    return (
      <div className="page narrow">
        <p className="callout tone-bad">
          No model bundle is installed ({error}).
        </p>
      </div>
    );
  if (!manifest)
    return (
      <div className="page narrow">
        <Spinner label="Reading the manifest…" />
      </div>
    );
  const m = manifest;
  const p = m.fallback_policy;
  const ev = m.evaluation;
  const timing = ev?.timing as
    | {
        warm_median_ms?: number;
        cold_ms?: number;
        boundary?: string;
        repeats?: number;
      }
    | undefined;
  const sameModel = health.modelId ? health.modelId === m.model_id : null;
  const smoke = (m.training?.hyperparameters as { epochs?: number } | undefined)
    ?.epochs;

  return (
    <div className="page narrow model-card">
      <header className="page-head">
        <h1>Model card</h1>
        <p className="model-identity">
          <code>{m.model_id}</code>
        </p>
        <div className="badges">
          <Badge tone="accent">{m.members.length}-member ensemble</Badge>
          <Badge>{m.raster.schema}</Badge>
          <Badge>dataset {m.dataset_id}</Badge>
          {sameModel === true && (
            <Badge tone="ok">same model as the local API</Badge>
          )}
          {sameModel === false && (
            <Badge tone="warn">the local API runs {health.modelId}</Badge>
          )}
          {engine.status === "ready" && (
            <Badge tone="ok">hashes verified in this browser</Badge>
          )}
          {smoke !== undefined && smoke < 5 && (
            <Badge tone="bad">development bundle ({smoke} epoch)</Badge>
          )}
        </div>
      </header>

      <section className="card-section">
        <h2>Evaluation against scikit-fem</h2>
        <p className="muted">
          {ev?.reference
            ? `${ev.reference.replace(/\.?\s*$/, ".")}`
            : "No evaluation recorded."}{" "}
          Splits are by parameter family, so test geometries are not
          near-duplicates of training ones. Errors are relative to the FEM field
          sampled on the same 64 × 128 grid and mask.
        </p>
        {ev && <EvaluationTable m={m} />}
        {ev?.shifted_routing && (
          <p className="small muted">
            Shifted split: {ev.shifted_routing.out_of_domain} of{" "}
            {ev.shifted_routing.cases} cases are flagged out of domain and
            routed to FEM. {asSentence(ev.shifted_routing.note)}
          </p>
        )}
      </section>

      <section className="card-section">
        <h2>Fallback policy</h2>
        <table className="kv">
          <tbody>
            <tr>
              <th>Metric</th>
              <td colSpan={3}>{p.metric ?? "—"}</td>
            </tr>
            <tr>
              <th>Threshold</th>
              <td className="mono">
                {p.threshold < 0
                  ? "reject all (no threshold met the target)"
                  : pct(p.threshold, 2)}
              </td>
              <th>Target</th>
              <td>
                {p.target
                  ? `p${Math.round(p.target.hotspot_error_quantile * 100)} peak error ≤ ${pct(p.target.max_hotspot_error, 0)}`
                  : "—"}
              </td>
            </tr>
            {(["calibration", "test"] as const).map((k) => {
              const s = p[k];
              if (!s) return null;
              return (
                <tr key={k}>
                  <th>{k === "test" ? "Test (held out)" : "Calibration"}</th>
                  <td>
                    {s.accepted ?? 0} / {s.cases ?? 0} accepted (
                    {pct(s.coverage ?? null, 0)})
                  </td>
                  <th>Accepted peak error</th>
                  <td className="mono">
                    p
                    {Math.round(
                      (p.target?.hotspot_error_quantile ?? 0.9) * 100,
                    )}{" "}
                    {pct(s.accepted_hotspot_error_quantile ?? null)} · median{" "}
                    {pct(s.accepted_hotspot_error_median ?? null)}
                  </td>
                </tr>
              );
            })}
            <tr>
              <th>Requires in-domain</th>
              <td colSpan={3}>
                {p.requires_in_domain === false ? "no" : "yes"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card-section">
        <h2>Training domain</h2>
        <table className="kv">
          <tbody>
            <tr>
              <th>Poisson's ratio</th>
              <td>
                <Range r={m.domain.poisson} />
              </td>
              <th>Hole clearance</th>
              <td className="mono">
                ≥ {pct(m.domain.hole_clearance_rel, 1)} of width
              </td>
            </tr>
            <tr>
              <th>Plate height / width</th>
              <td>
                <Range r={m.domain.plate.aspect} />
              </td>
              <th>Plate holes</th>
              <td>
                <Range r={m.domain.plate.holes} /> · radius{" "}
                <Range
                  r={m.domain.plate.hole_radius_rel}
                  scale={100}
                  unit="% W"
                />
              </td>
            </tr>
            <tr>
              <th>Bracket height / width</th>
              <td>
                <Range r={m.domain.bracket.aspect} />
              </td>
              <th>Bracket holes</th>
              <td>
                <Range r={m.domain.bracket.holes} /> · radius{" "}
                <Range
                  r={m.domain.bracket.hole_radius_rel}
                  scale={100}
                  unit="% W"
                />
              </td>
            </tr>
            <tr>
              <th>Web width</th>
              <td>
                <Range
                  r={m.domain.bracket.web_width_rel}
                  scale={100}
                  unit="% W"
                />
              </td>
              <th>Flange / fillet</th>
              <td>
                <Range
                  r={m.domain.bracket.flange_height_rel_height}
                  scale={100}
                  unit="% H"
                />{" "}
                ·{" "}
                <Range
                  r={m.domain.bracket.fillet_radius_rel}
                  scale={100}
                  unit="% W"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card-section">
        <h2>Members and provenance</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Seed</th>
              <th>Best epoch</th>
              <th>Parameters</th>
              <th>Size</th>
              <th>SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {m.members.map((mb) => (
              <tr key={mb.member}>
                <td>{mb.member}</td>
                <td className="mono">{mb.seed}</td>
                <td className="mono">{mb.best_epoch ?? "—"}</td>
                <td className="mono">
                  {mb.parameters?.toLocaleString() ?? "—"}
                </td>
                <td className="mono">{(mb.bytes / 1e6).toFixed(1)} MB</td>
                <td className="mono hash" title={mb.sha256}>
                  {mb.sha256.slice(0, 16)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="kv">
          <tbody>
            <tr>
              <th>Architecture</th>
              <td>
                {String(m.architecture.name)} · base{" "}
                {String(m.architecture.base)} · depth{" "}
                {String(m.architecture.depth)}
              </td>
              <th>ONNX parity</th>
              <td className="mono">
                {m.parity
                  ? `${m.parity.max_rel_diff.toExponential(1)} (tol ${m.parity.tolerance.toExponential(0)})`
                  : "—"}
              </td>
            </tr>
            <tr>
              <th>Run</th>
              <td className="mono">{m.run_id ?? "—"}</td>
              <th>Created</th>
              <td>
                {m.created_unix
                  ? new Date(m.created_unix * 1000)
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ") + " UTC"
                  : "—"}
              </td>
            </tr>
            {timing && (
              <tr>
                <th>Inference timing</th>
                <td colSpan={3}>
                  warm median {ms(timing.warm_median_ms ?? null)}
                  {timing.cold_ms != null && (
                    <>, cold {ms(timing.cold_ms)}</>
                  )} · {timing.boundary}
                  {ev?.host && <> · {Object.values(ev.host).join(", ")}</>}
                </td>
              </tr>
            )}
            {engine.engine && (
              <tr>
                <th>This browser</th>
                <td colSpan={3}>
                  loaded and verified in {ms(engine.engine.loadMs)} ·
                  WebAssembly, {engine.engine.threads} thread
                  {engine.engine.threads === 1 ? "" : "s"}
                  {typeof crossOriginIsolated !== "undefined" &&
                  crossOriginIsolated
                    ? " (cross-origin isolated)"
                    : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
