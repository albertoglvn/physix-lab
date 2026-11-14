import { Download, Play, ShieldCheck, Square } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Case } from "../../physics/case";
import { Badge } from "../../ui/controls";
import { mpa, pct } from "../../ui/units";
import { formatValue } from "../data/Plot";
import {
  checkStressSpec,
  confirmStressPoint,
  MAX_STRESS_POINTS,
  runStressSweep,
  SOURCE_LABELS,
  stressSweepVariables,
  summarizeStressSweep,
  sweepValues,
  type StressPoint,
  type StressSource,
  type StressSweepDeps,
  type StressSweepSpec,
} from "./stressSweep";
import { StudyPlot, type StudyMark } from "./StudyPlot";

export const SOURCE_COLOURS: Record<StressSource, string> = {
  surrogate: "var(--px-series-1)",
  fem: "var(--px-series-2)",
  fem_fallback: "var(--px-series-3)",
};

const SOURCE_TONES: Record<StressSource, "ok" | "accent" | "warn"> = {
  surrogate: "ok",
  fem: "accent",
  fem_fallback: "warn",
};

/** Text fields in millimetres, as the student types them. */
export type StressSweepForm = {
  variable: string;
  from: string;
  to: string;
  count: string;
};

export type StressSweepRun = {
  forCase: string;
  base: Case;
  spec: StressSweepSpec;
  points: StressPoint[];
  status: "running" | "done" | "cancelled";
};

const round = (metres: number) => String(Number((metres * 1e3).toPrecision(4)));

/** The form for this case: the stored one while its variable exists, else a fresh one. */
export function reconcileStressForm(
  c: Case,
  stored: StressSweepForm | undefined,
): StressSweepForm {
  const variables = stressSweepVariables(c);
  if (stored && variables.some((v) => v.path === stored.variable))
    return stored;
  const first = variables[0];
  return {
    variable: first?.path ?? "",
    from: first ? round(first.min) : "",
    to: first ? round(first.max) : "",
    count: "9",
  };
}

export function formForStressVariable(
  c: Case,
  form: StressSweepForm,
  path: string,
): StressSweepForm {
  const v = stressSweepVariables(c).find((item) => item.path === path);
  return v
    ? { ...form, variable: path, from: round(v.min), to: round(v.max) }
    : form;
}

export function stressFormToSpec(
  c: Case,
  form: StressSweepForm,
): { spec?: StressSweepSpec; error?: string } {
  const from = Number(form.from) / 1e3;
  const to = Number(form.to) / 1e3;
  const count = Number(form.count);
  if (!form.from.trim() || !form.to.trim() || !Number.isFinite(from + to))
    return { error: "Enter the range in millimetres." };
  if (!Number.isInteger(count) || count < 1 || count > MAX_STRESS_POINTS)
    return { error: `Use 1 to ${MAX_STRESS_POINTS} points.` };
  const spec = {
    variable: form.variable,
    values: sweepValues(from, to, count),
  };
  const error = checkStressSpec(c, spec);
  return error ? { error } : { spec };
}

/** Sweep state kept by the study, so closing the sheet does not lose a run. */
export function useStressSweep() {
  const [form, setForm] = useState<StressSweepForm>();
  const [run, setRun] = useState<StressSweepRun | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = async (
    c: Case,
    spec: StressSweepSpec,
    deps: StressSweepDeps,
  ) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const forCase = JSON.stringify(c);
    setRun({ forCase, base: c, spec, points: [], status: "running" });
    await runStressSweep(
      c,
      spec,
      deps,
      (point) =>
        setRun((current) =>
          current && current.forCase === forCase && current.spec === spec
            ? { ...current, points: [...current.points, point] }
            : current,
        ),
      controller.signal,
    );
    setRun((current) =>
      current && current.spec === spec
        ? {
            ...current,
            status: controller.signal.aborted ? "cancelled" : "done",
          }
        : current,
    );
  };

  const cancel = () => abort.current?.abort();

  const confirm = async (
    index: number,
    solve: NonNullable<StressSweepDeps["solve"]>,
  ) => {
    if (!run) return;
    const point = run.points.find((p) => p.index === index);
    if (!point) return;
    setChecking(index);
    const next = await confirmStressPoint(run.base, run.spec, point, solve);
    setChecking(null);
    setRun((current) =>
      current && current.spec === run.spec
        ? {
            ...current,
            points: current.points.map((p) => (p.index === index ? next : p)),
          }
        : current,
    );
  };

  return { form, setForm, run, start, cancel, confirm, checking };
}

export type StressSweepState = ReturnType<typeof useStressSweep>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="lab-select lab-select--inline">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function sweepMarks(points: StressPoint[]): StudyMark[] {
  const xmm = (p: StressPoint) => p.x * 1e3;
  return points.flatMap((p) => {
    const marks: StudyMark[] = [];
    if (p.surrogate && Number.isFinite(p.surrogate.hotspot)) {
      const h = p.surrogate.hotspot / 1e6;
      const spread = Number.isFinite(p.surrogate.disagreement)
        ? h * p.surrogate.disagreement
        : 0;
      marks.push({
        x: xmm(p),
        y: h,
        color: SOURCE_COLOURS.surrogate,
        hollow: true,
        low: h - spread,
        high: h + spread,
      });
    }
    if (p.fem && p.source && p.source !== "surrogate")
      marks.push({
        x: xmm(p),
        y: p.fem.hotspot / 1e6,
        color: SOURCE_COLOURS[p.source],
      });
    return marks;
  });
}

export type StressSweepSheetProps = {
  c: Case;
  state: StressSweepState;
  deps: StressSweepDeps;
  modelReady: boolean;
  online: boolean;
  onExport: (run: StressSweepRun) => void;
};

/**
 * Sweep setup and results for the Stress study. The surrogate screens every point; the
 * fallback policy sends rejected points to FEM, and any screened point can be confirmed.
 */
export function StressSweepSheet({
  c,
  state,
  deps,
  modelReady,
  online,
  onExport,
}: StressSweepSheetProps) {
  const form = reconcileStressForm(c, state.form);
  const set = (patch: Partial<StressSweepForm>) =>
    state.setForm({ ...form, ...patch });
  const variables = stressSweepVariables(c);
  const outcome = stressFormToSpec(c, form);
  const run = state.run;
  const running = run?.status === "running";
  const stale = run && run.forCase !== JSON.stringify(c);
  const summary = run ? summarizeStressSweep(run.points) : null;
  const variable = run
    ? stressSweepVariables(run.base).find((v) => v.path === run.spec.variable)
    : undefined;
  const text = (key: "from" | "to" | "count", label: string) => (
    <Field label={label}>
      <input
        className="px-input"
        inputMode="decimal"
        value={form[key]}
        onChange={(event) => set({ [key]: event.currentTarget.value })}
      />
    </Field>
  );

  return (
    <div className="lab-stress-study">
      <p className="lab-sheet-lead">
        The surrogate screens every point. A point the fallback policy rejects,
        or that the model cannot take, is solved with FEM, and you can confirm
        any screened point with FEM. Each point shows its source.
      </p>
      {!modelReady ? (
        <p className="lab-note">
          The model is not loaded, so every point will be solved with FEM.
        </p>
      ) : null}
      {!online ? (
        <p className="lab-note">
          The solver is offline: points that need FEM will have no value.
        </p>
      ) : null}
      <form
        className="lab-sweep-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (outcome.spec && !running) void state.start(c, outcome.spec, deps);
        }}
      >
        <Field label="Vary">
          <select
            className="px-input"
            value={form.variable}
            onChange={(event) =>
              state.setForm(
                formForStressVariable(c, form, event.currentTarget.value),
              )
            }
          >
            {variables.map((item) => (
              <option key={item.path} value={item.path}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="lab-fields">
          {text("from", "From (mm)")}
          {text("to", "To (mm)")}
          {text("count", "Points")}
        </div>
        {outcome.error ? (
          <p className="lab-error" role="alert">
            {outcome.error}
          </p>
        ) : (
          <p className="lab-note num">
            {outcome.spec?.values.length} points, screened one at a time; each
            FEM solve takes a few seconds in the browser.
          </p>
        )}
        <div className="lab-sheet-actions">
          {running ? (
            <button type="button" className="lab-button" onClick={state.cancel}>
              <Square size={15} aria-hidden="true" /> Stop
            </button>
          ) : null}
          <button
            type="submit"
            className="lab-button lab-button--dark"
            disabled={!outcome.spec || running}
          >
            <Play size={15} aria-hidden="true" /> Run sweep
          </button>
        </div>
      </form>
      {run && summary ? (
        <section className="lab-stress-results" aria-label="Sweep results">
          <p className="lab-note num" role="status">
            {run.status === "running"
              ? `Running ${run.points.length} of ${run.spec.values.length}…`
              : run.status === "cancelled"
                ? `Stopped after ${run.points.length} of ${run.spec.values.length} points.`
                : `${run.points.length} points.`}{" "}
            {summary.counts.surrogate} surrogate · {summary.counts.fem_fallback}{" "}
            FEM fallback · {summary.counts.fem} FEM
            {summary.missing ? ` · ${summary.missing} without a value` : ""}
            {summary.maxSurrogateError !== null
              ? ` · surrogate vs FEM hotspot error up to ${pct(summary.maxSurrogateError)} over ${summary.compared} solved ${summary.compared === 1 ? "point" : "points"}`
              : ""}
          </p>
          {stale ? (
            <p className="lab-note">
              The part changed since this sweep; it shows the part as it was.
            </p>
          ) : null}
          <StudyPlot
            marks={sweepMarks(run.points)}
            xAxis={{
              label: variable?.label ?? run.spec.variable,
              symbol: "x",
              unit: "mm",
            }}
            yAxis={{ label: "Peak von Mises", symbol: "σ", unit: "MPa" }}
            domain={[
              run.spec.values[0] * 1e3,
              run.spec.values[run.spec.values.length - 1] * 1e3,
            ]}
            keys={[
              {
                label: "Surrogate, ±1σ ensemble spread",
                color: SOURCE_COLOURS.surrogate,
                hollow: true,
              },
              { label: "FEM fallback", color: SOURCE_COLOURS.fem_fallback },
              { label: "FEM", color: SOURCE_COLOURS.fem },
            ]}
            label={`Peak von Mises stress against ${(variable?.label ?? "the variable").toLowerCase()}, ${run.points.length} points`}
          />
          <p className="lab-note">
            Whiskers are the spread between the ensemble members, not solver
            error. Grid-basis hotspots compare the surrogate and FEM on the same
            mask.
          </p>
          <div className="lab-table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Value (mm)</th>
                  <th scope="col">Source</th>
                  <th scope="col">Peak</th>
                  <th scope="col">Spread</th>
                  <th scope="col">Note</th>
                  <th scope="col">
                    <span className="px-visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {run.points.map((p) => (
                  <tr key={p.index}>
                    <td className="num">{p.index + 1}</td>
                    <td className="num">{formatValue(p.x * 1e3)}</td>
                    <td>
                      {p.source ? (
                        <Badge tone={SOURCE_TONES[p.source]}>
                          {SOURCE_LABELS[p.source]}
                        </Badge>
                      ) : (
                        <Badge tone="bad">No value</Badge>
                      )}
                    </td>
                    <td className="num">{mpa(p.value)}</td>
                    <td className="num">
                      {p.surrogate ? pct(p.surrogate.disagreement) : "—"}
                    </td>
                    <td>
                      {p.source === "fem" && p.surrogate && p.fem
                        ? `Surrogate ${mpa(p.surrogate.hotspot)}, ${pct(
                            Math.abs(p.surrogate.hotspot - p.fem.hotspot) /
                              p.fem.hotspot,
                          )} off`
                        : (p.note ?? "")}
                    </td>
                    <td>
                      {p.source === "surrogate" ? (
                        <button
                          type="button"
                          className="lab-button lab-stress-check"
                          disabled={
                            !deps.solve ||
                            running ||
                            state.checking !== null ||
                            !!stale
                          }
                          onClick={() =>
                            deps.solve &&
                            void state.confirm(p.index, deps.solve)
                          }
                        >
                          <ShieldCheck size={13} aria-hidden="true" />
                          {state.checking === p.index ? "Solving…" : "Check"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lab-sheet-actions">
            <button
              type="button"
              className="lab-button"
              disabled={running || !run.points.length}
              onClick={() => onExport(run)}
            >
              <Download size={15} aria-hidden="true" /> Export CSV
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
