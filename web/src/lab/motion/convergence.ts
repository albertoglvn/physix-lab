import type { LabScene } from "../scene";
import { TIME_STEP } from "../simulation";
import type { Protocol } from "./probes";
import { runProtocol } from "./run";
import type { Reference } from "./theory";

/** Default pass threshold: relative change between the two finest steps (LAB_PLAN.md §4.1). */
export const CONVERGENCE_TOLERANCE = 0.01;

export type ConvergenceResult = {
  referenceId: string;
  label: string;
  unit: string;
  steps: number[];
  values: (number | undefined)[];
  /** Relative change between the two finest steps. */
  change?: number;
  /** Observed order p = log2(|q₁ − q₂| / |q₂ − q₃|), when both differences are resolvable. */
  order?: number;
  tolerance: number;
  passed: boolean;
  note?: string;
};

/**
 * Re-runs the protocol at Δt, Δt/2 and Δt/4 and reports how the reference's measured
 * quantity changes: the Motion counterpart of the mesh-convergence check.
 */
export async function checkConvergence(
  scene: LabScene,
  protocol: Protocol,
  reference: Reference,
  { base = TIME_STEP, tolerance = CONVERGENCE_TOLERANCE } = {},
): Promise<ConvergenceResult> {
  const steps = [base, base / 2, base / 4];
  const values: (number | undefined)[] = [];
  for (const timeStep of steps) {
    const run = await runProtocol(scene, protocol, { timeStep });
    const value = reference.measure(run);
    values.push(
      value !== undefined && Number.isFinite(value) ? value : undefined,
    );
  }
  const result: ConvergenceResult = {
    referenceId: reference.id,
    label: reference.label,
    unit: reference.unit,
    steps,
    values,
    tolerance,
    passed: false,
  };
  const [q1, q2, q3] = values;
  if (q1 === undefined || q2 === undefined || q3 === undefined)
    return {
      ...result,
      note: "The run did not reach the event at every step size.",
    };
  const scale = Math.max(Math.abs(q3), reference.floor, Number.EPSILON);
  const change = Math.abs(q2 - q3) / scale;
  const coarse = Math.abs(q1 - q2);
  const fine = Math.abs(q2 - q3);
  const resolvable = coarse > 1e-12 * scale && fine > 1e-12 * scale;
  const order = resolvable ? Math.log2(coarse / fine) : undefined;
  return {
    ...result,
    change,
    order: order !== undefined && order > 0 ? order : undefined,
    passed: change <= tolerance,
    note: !resolvable
      ? "The values agree to the step resolution, so no order is defined."
      : order !== undefined && order <= 0
        ? "The change did not shrink with the step, so no order is defined."
        : undefined,
  };
}
