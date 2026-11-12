import { Download, PenLine, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import type { VerifyResponse } from "../../api/client";
import type { SurrogatePrediction } from "../../inference/engine";
import type { Case } from "../../physics/case";
import { resultantForce } from "../../physics/case";
import type { FieldKey } from "../../studio/fields";
import { FIELD_OPTIONS } from "../../studio/fields";
import { mm, mpa, newtons, pct } from "../../ui/units";
import { Plot } from "../data/Plot";
import { profileDifference, relativeError } from "./compare";
import {
  gridSampler,
  isSectionCut,
  lineLength,
  linePoints,
  meshField,
  meshSampler,
  probeCsv,
  probeProfile,
  PROBE_SAMPLES,
  SECTION_SAMPLES,
  sectionResultant,
  surrogateSampler,
  type LinePreset,
  type Point,
  type ProbeComponent,
  type ProbeLine,
  type ProbeProfile,
} from "./probe";

const COMPONENT: Record<Exclude<FieldKey, "spread">, ProbeComponent> = {
  von_mises: "vonMises",
  sxx: "sxx",
  syy: "syy",
  txy: "txy",
};

const SYMBOL: Record<FieldKey, string> = {
  von_mises: "σvm",
  sxx: "σxx",
  syy: "σyy",
  txy: "τxy",
  spread: "s",
};

const point = ([x, y]: Point) => `${mm(x, 3)}, ${mm(y, 3)}`;
const toMm = (values: number[]) => values.map((v) => v * 1e3);
const toMpa = (values: number[]) => values.map((v) => v / 1e6);

export type StressProbeProps = {
  /** The case the surrogate field belongs to. */
  c: Case;
  pred: SurrogatePrediction | null;
  modelId: string | null;
  mask: Uint8Array;
  field: FieldKey;
  line: ProbeLine;
  presets: LinePreset[];
  preset: string | null;
  onPreset: (id: string) => void;
  drawing: boolean;
  onDrawingChange: (drawing: boolean) => void;
  /** A finished FEM check of this same case, or null. */
  fem: VerifyResponse | null;
  canSolve: boolean;
  onSolve: () => void;
  onExport: (csv: string) => void;
};

/** Stress along a line: surrogate profile, FEM reference and the section balance. */
export function StressProbe({
  c,
  pred,
  modelId,
  mask,
  field,
  line,
  presets,
  preset,
  onPreset,
  drawing,
  onDrawingChange,
  fem,
  canSolve,
  onSolve,
  onExport,
}: StressProbeProps) {
  const option = FIELD_OPTIONS.find((o) => o.value === field)!;
  const component = field === "spread" ? null : COMPONENT[field];

  const surrogate = useMemo(
    () =>
      pred
        ? probeProfile(
            surrogateSampler(c, pred.result.mean, mask),
            line,
            "surrogate",
          )
        : null,
    [c, pred, mask, line],
  );
  const spread = useMemo(() => {
    if (!pred || field !== "spread") return null;
    const sample = gridSampler(c, [pred.result.stdVonMises], mask);
    return linePoints(line, PROBE_SAMPLES).map(
      ([x, y]) => sample(x, y)?.[0] ?? Number.NaN,
    );
  }, [c, pred, mask, line, field]);

  const femSampler = useMemo(() => {
    const field = fem?.mesh ? meshField(fem.mesh) : null;
    return field ? meshSampler(field) : null;
  }, [fem]);
  const reference = useMemo(
    () => (femSampler ? probeProfile(femSampler, line, "fem") : null),
    [femSampler, line],
  );

  const section = useMemo(() => {
    if (!isSectionCut(c, line)) return null;
    const resultant = (profile: ProbeProfile | null) =>
      profile ? sectionResultant(c, profile) : null;
    return {
      applied: resultantForce(c),
      surrogate: pred
        ? resultant(
            probeProfile(
              surrogateSampler(c, pred.result.mean, mask),
              line,
              "surrogate",
              SECTION_SAMPLES,
            ),
          )
        : null,
      fem: femSampler
        ? resultant(probeProfile(femSampler, line, "fem", SECTION_SAMPLES))
        : null,
    };
  }, [c, pred, mask, line, femSampler]);

  const difference =
    surrogate && reference && component
      ? profileDifference(surrogate, reference, component)
      : null;

  const values = component ? surrogate?.[component] : (spread ?? undefined);

  const exportCsv = () => {
    const profiles = [surrogate, reference].filter(
      (p): p is ProbeProfile => p != null,
    );
    onExport(
      probeCsv(profiles, [
        `case: ${c.family}, thickness ${c.thickness} m`,
        `model: ${modelId ?? "none"}`,
        `solver: ${fem?.solver ? `${fem.solver.name} ${fem.solver.version}, ${fem.solver.mesh_preset} mesh` : "not run"}`,
      ]),
    );
  };

  const presetValue = preset ?? "custom";

  return (
    <div className="lab-data">
      <div className="lab-data-bar">
        <select
          className="px-input lab-data-quantity"
          aria-label="Probe line"
          value={presetValue}
          onChange={(event) => onPreset(event.currentTarget.value)}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {preset ? null : <option value="custom">Drawn line</option>}
        </select>
        <span className="lab-data-target">{option.title}</span>
        <span className="lab-data-actions">
          <button
            type="button"
            className="lab-button"
            aria-pressed={drawing}
            onClick={() => onDrawingChange(!drawing)}
            title="Press and drag over the part to draw a new line"
          >
            <PenLine size={15} aria-hidden="true" />
            <span>{drawing ? "Drawing…" : "Draw"}</span>
          </button>
          <button
            type="button"
            className="lab-button"
            disabled={!surrogate && !reference}
            onClick={exportCsv}
            title="Profiles in SI units, one row per point"
          >
            <Download size={15} aria-hidden="true" />
            <span>Export</span>
          </button>
        </span>
      </div>
      <div className="lab-data-body">
        <div className="lab-data-main">
          {surrogate && values ? (
            <Plot
              series={{
                label: option.label,
                symbol: SYMBOL[field],
                unit: "MPa",
                color: "var(--px-series-1)",
                t: toMm(surrogate.s),
                values: toMpa(values),
              }}
              reference={
                reference && component
                  ? {
                      t: toMm(reference.s),
                      values: toMpa(reference[component]),
                    }
                  : undefined
              }
              domain={lineLength(line) * 1e3}
              axis={{ label: "Distance along line", symbol: "s", unit: "mm" }}
              keys={{ series: "Surrogate", reference: "FEM" }}
            />
          ) : (
            <p className="lab-note">
              The profile appears once the ensemble has a prediction.
            </p>
          )}
        </div>
        <aside className="lab-data-side" aria-label="Probe checks">
          <ul className="lab-compare">
            <li>
              <div className="lab-compare-head">
                Line <small>{mm(lineLength(line), 3)}</small>
              </div>
              <dl className="lab-probe-ends">
                <dt>A</dt>
                <dd className="num">{point(line.a)}</dd>
                <dt>B</dt>
                <dd className="num">{point(line.b)}</dd>
              </dl>
            </li>
            {section ? (
              <li>
                <div className="lab-compare-head">
                  Section balance
                  <small>t ∫ σ·n ds along the load</small>
                </div>
                <dl className="lab-probe-ends">
                  <dt>Applied</dt>
                  <dd className="num">
                    {newtons(Math.hypot(...section.applied))}
                  </dd>
                  <SectionRow
                    label="Surrogate"
                    value={section.surrogate}
                    applied={section.applied}
                  />
                  <SectionRow
                    label="FEM"
                    value={section.fem}
                    applied={section.applied}
                  />
                </dl>
              </li>
            ) : null}
            <li>
              <div className="lab-compare-head">
                Surrogate against FEM
                <small>along this line</small>
              </div>
              {difference && difference.count ? (
                <dl className="lab-probe-ends">
                  <dt>RMSE</dt>
                  <dd className="num">{mpa(difference.rmse)}</dd>
                  <dt>Max</dt>
                  <dd className="num">{mpa(difference.maxAbs)}</dd>
                </dl>
              ) : reference ? (
                <p className="lab-note">
                  {component
                    ? "No points lie in the solid on both fields."
                    : "Disagreement is the spread between models; FEM has no counterpart."}
                </p>
              ) : (
                <p className="lab-check">
                  <button
                    type="button"
                    className="lab-button"
                    disabled={!canSolve}
                    onClick={onSolve}
                  >
                    <ShieldCheck size={15} aria-hidden="true" />
                    <span>Run FEM check</span>
                  </button>
                  {fem && !femSampler
                    ? "This solver response has no element stress."
                    : null}
                </p>
              )}
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

function SectionRow({
  label,
  value,
  applied,
}: {
  label: string;
  value: Point | null;
  applied: [number, number];
}) {
  // The cut's resultant projected on the load direction, against the applied magnitude.
  const magnitude = Math.hypot(...applied);
  const along = value
    ? magnitude > 0
      ? (value[0] * applied[0] + value[1] * applied[1]) / magnitude
      : Math.hypot(...value)
    : null;
  const error = relativeError(along, magnitude);
  return (
    <>
      <dt>{label}</dt>
      <dd className="num">
        {along != null ? newtons(along) : "—"}
        {error != null ? <small> {signedPct(error)}</small> : null}
      </dd>
    </>
  );
}

export const signedPct = (fraction: number) =>
  `${fraction >= 0 ? "+" : "−"}${pct(Math.abs(fraction))}`;
