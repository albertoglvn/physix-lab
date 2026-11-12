import { Dices, Play } from "lucide-react";
import { useState, type ReactNode } from "react";
import { freshSeed } from "../data/random";
import type { LabScene } from "../scene";
import { Sheet } from "../ui/Sheet";
import type { Protocol } from "./probes";
import {
  metricKey,
  metricOption,
  sweepMetrics,
  sweepVariables,
  type SweepSpec,
} from "./sweep";
import {
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

type TextField = Exclude<keyof SweepForm, "noise">;

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

/** The sweep setup sheet: one variable over a range, one metric, optional synthetic noise. */
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
  const count = outcome.spec?.values.length ?? 0;
  const workers = Math.min(poolSize(), count);
  const readings = outcome.spec?.noise ? count * outcome.spec.repeats : 0;

  return (
    <Sheet open={open} title="Sweep setup" onClose={onClose}>
      <p className="lab-sheet-lead">
        Each value runs once with the current protocol; runs are deterministic,
        so repeats only differ by synthetic noise.
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
        <label className="lab-toggle">
          <input
            type="checkbox"
            checked={form.noise}
            onChange={(event) => set({ noise: event.currentTarget.checked })}
          />
          <span>Synthetic sensor noise</span>
        </label>
        {form.noise ? (
          <div className="lab-fields">
            {text("sigma", "σ", metricUnit)}
            {text("resolution", "Resolution", metricUnit)}
            {text("repeats", "Readings per value")}
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
            {count} {count === 1 ? "run" : "runs"} on {workers}{" "}
            {workers === 1 ? "worker" : "workers"}
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
