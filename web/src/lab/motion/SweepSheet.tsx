import { Dices, Play } from "lucide-react";
import { useState, type ReactNode } from "react";
import { freshSeed } from "../data/random";
import type { LabScene } from "../scene";
import { Sheet } from "../ui/Sheet";
import type { Protocol } from "./probes";
import {
  metricKey,
  metricOption,
  perturbationVariables,
  pointCount,
  runCount,
  sweepMetrics,
  sweepVariables,
  type SweepSpec,
} from "./sweep";
import {
  formForPerturbation,
  formForSecond,
  formForVariable,
  formToSpec,
  reconcileForm,
  type SweepForm,
} from "./sweepForm";
import { poolSize } from "./sweepPool";

export type SweepSheetProps = {
  open: boolean;
  scene: LabScene;
  protocol: Protocol;
  running: boolean;
  onClose: () => void;
  onRun: (spec: SweepSpec) => void;
};

type TextField = Exclude<keyof SweepForm, "noise" | "grid" | "perturb">;

function Field({
  label,
  unit,
  children,
}: {
  label: string;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <label className="lab-select lab-select--inline">
      <span>
        {label}
        {unit ? <span className="px-field-unit"> ({unit})</span> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * The sweep setup sheet: one variable over a range or two on a grid, one metric, and
 * optional synthetic noise or perturbed starts for repeats.
 */
export function SweepSheet({
  open,
  scene,
  protocol,
  running,
  onClose,
  onRun,
}: SweepSheetProps) {
  const [stored, setStored] = useState<SweepForm>();
  const form = reconcileForm(scene, stored);
  const set = (patch: Partial<SweepForm>) => setStored({ ...form, ...patch });
  const variables = sweepVariables(scene);
  const variable = variables.find((item) => item.path === form.variable);
  const second = variables.find((item) => item.path === form.variable2);
  const initial = perturbationVariables(scene);
  const perturbed = initial.find((item) => item.path === form.perturbVariable);
  const metrics = sweepMetrics(scene);
  const outcome = formToSpec(form, scene, protocol);
  const metricUnit = outcome.spec
    ? (metricOption(scene, outcome.spec.metric)?.unit ?? "")
    : (metrics.find((item) => metricKey(item.metric) === form.metric)?.unit ??
      "");
  const text = (key: TextField, label: string, unit?: string) => (
    <Field label={label} unit={unit}>
      <input
        className="px-input"
        inputMode="decimal"
        value={form[key]}
        onChange={(event) => set({ [key]: event.currentTarget.value })}
      />
    </Field>
  );
  const spec = outcome.spec;
  const points = spec ? pointCount(spec) : 0;
  const runs = spec ? runCount(spec) : 0;
  const workers = Math.min(poolSize(), points);
  const readings =
    spec && (spec.noise || spec.perturbation) ? points * spec.repeats : 0;
  const toggle = (
    key: "grid" | "noise" | "perturb",
    label: string,
    disabled = false,
  ) => (
    <label className="lab-toggle">
      <input
        type="checkbox"
        checked={form[key]}
        disabled={disabled}
        onChange={(event) => set({ [key]: event.currentTarget.checked })}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <Sheet open={open} title="Sweep setup" onClose={onClose}>
      <p className="lab-sheet-lead">
        Each point runs once with the current protocol. Runs are deterministic,
        so repeats differ only by synthetic sensor noise or by a seeded
        perturbation of one starting value.
      </p>
      <form
        className="lab-sweep-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (outcome.spec && !running) onRun(outcome.spec);
        }}
      >
        <Field label="Vary">
          <select
            className="px-input"
            value={form.variable}
            onChange={(event) =>
              setStored(formForVariable(scene, form, event.currentTarget.value))
            }
          >
            {variables.map((item) => (
              <option key={item.path} value={item.path}>
                {item.label}
                {item.unit ? ` (${item.unit})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="lab-fields lab-fields--three">
          {text("from", "From", variable?.unit)}
          {text("to", "To", variable?.unit)}
          {text("step", "Step", variable?.unit)}
        </div>
        {toggle("grid", "Second variable on a grid", variables.length < 2)}
        {form.grid ? (
          <>
            <Field label="And vary">
              <select
                className="px-input"
                value={form.variable2}
                onChange={(event) =>
                  setStored(
                    formForSecond(scene, form, event.currentTarget.value),
                  )
                }
              >
                {variables
                  .filter((item) => item.path !== form.variable)
                  .map((item) => (
                    <option key={item.path} value={item.path}>
                      {item.label}
                      {item.unit ? ` (${item.unit})` : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="lab-fields lab-fields--three">
              {text("from2", "From", second?.unit)}
              {text("to2", "To", second?.unit)}
              {text("step2", "Step", second?.unit)}
            </div>
          </>
        ) : null}
        <Field label="Read">
          <select
            className="px-input"
            value={form.metric}
            onChange={(event) => set({ metric: event.currentTarget.value })}
          >
            {metrics.map((item) => (
              <option
                key={metricKey(item.metric)}
                value={metricKey(item.metric)}
              >
                {item.label}
                {item.unit ? ` (${item.unit})` : ""}
              </option>
            ))}
          </select>
        </Field>
        {toggle("noise", "Synthetic sensor noise")}
        {form.noise ? (
          <div className="lab-fields">
            {text("sigma", "σ", metricUnit)}
            {text("resolution", "Resolution", metricUnit)}
          </div>
        ) : null}
        {toggle("perturb", "Perturb a starting value", !initial.length)}
        {form.perturb ? (
          <div className="lab-fields">
            <Field label="Perturb">
              <select
                className="px-input"
                value={form.perturbVariable}
                onChange={(event) =>
                  setStored(
                    formForPerturbation(scene, form, event.currentTarget.value),
                  )
                }
              >
                {initial.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.label}
                    {item.unit ? ` (${item.unit})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {text("perturbSigma", "σ", perturbed?.unit)}
          </div>
        ) : null}
        {form.noise || form.perturb ? (
          <div className="lab-fields">
            {text("repeats", "Readings per point")}
            <Field label="Seed">
              <span className="lab-seed">
                <input
                  className="px-input"
                  inputMode="numeric"
                  value={form.seed}
                  onChange={(event) => set({ seed: event.currentTarget.value })}
                />
                <button
                  type="button"
                  className="px-icon-button"
                  aria-label="New seed"
                  title="New seed"
                  onClick={() => set({ seed: String(freshSeed()) })}
                >
                  <Dices size={16} aria-hidden="true" />
                </button>
              </span>
            </Field>
          </div>
        ) : null}
        {outcome.error ? (
          <p className="lab-error" role="alert">
            {outcome.error}
          </p>
        ) : (
          <p className="lab-note num">
            {runs} {runs === 1 ? "run" : "runs"} on {workers}{" "}
            {workers === 1 ? "worker" : "workers"}
            {spec?.second
              ? ` · ${spec.values.length} × ${spec.second.values.length} grid`
              : ""}
            {readings ? ` · ${readings} synthetic readings` : ""}
          </p>
        )}
        <div className="lab-sheet-actions">
          <button
            type="submit"
            className="lab-button lab-button--dark"
            disabled={!outcome.spec || running}
          >
            <Play size={15} aria-hidden="true" /> Run sweep
          </button>
        </div>
      </form>
    </Sheet>
  );
}
