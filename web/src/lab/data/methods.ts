import type { ConvergenceResult } from "../motion/convergence";
import type { EventType } from "../motion/probes";
import type { MotionRun } from "../motion/run";
import { CONTACT_MODEL, type Comparison } from "../motion/theory";
import { isBody, MATERIALS } from "../scene";

const PAST_EVENTS: Record<EventType, string> = {
  rest: "came to rest",
  leaves_ramp: "left the ramp",
  floor_contact: "touched the floor",
  bounce: "bounced",
  collision: "met another body",
  pulley_stop: "reached its stop",
};

const significant = (value: number, digits = 4) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : "—";

/** "1/120 s" for a reciprocal step, otherwise the plain value. */
export function formatStep(step: number) {
  const reciprocal = 1 / step;
  return Math.abs(reciprocal - Math.round(reciprocal)) < 1e-9
    ? `1/${Math.round(reciprocal)} s`
    : `${significant(step)} s`;
}

/** Signed difference as "+0.08 %" when relative, or in the reference's unit. */
export function formatDelta(comparison: Comparison) {
  const { delta, relative, reference } = comparison;
  if (delta === undefined) return "pending";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return relative
    ? `${sign}${significant(Math.abs(delta) * 100, 2)} %`
    : `${sign}${significant(Math.abs(delta), 2)} ${reference.unit}`;
}

/**
 * A methods paragraph a student can paste into a report: engine, step, probes, stop,
 * contact model, references with their differences, the step check and the run identity.
 */
export function methodsSummary(
  run: MotionRun,
  comparisons: Comparison[],
  convergence?: ConvergenceResult,
): string {
  const { inputs, engine } = run;
  const { scene } = inputs;
  const stop = run.stop.event
    ? `when ${run.stop.event.target} ${PAST_EVENTS[run.stop.event.type]}`
    : "at the time limit";
  const surfaces = [
    `floor μ = ${scene.floorFriction}`,
    ...scene.objects.flatMap((part) => {
      if (part.kind === "ramp")
        return [`${part.id} μ = ${part.friction} at ${part.angle}°`];
      if (!isBody(part) || (part.friction === undefined && !part.restitution))
        return [];
      const made = part.material ? ` (${MATERIALS[part.material].label})` : "";
      const mu = part.friction === undefined ? "" : `μ = ${part.friction}, `;
      return [`${part.id}${made} ${mu}e = ${part.restitution}`];
    }),
  ];
  const sentences = [
    `The ${scene.name} scene was simulated with ${engine.name} ${engine.version} using a fixed step of ${formatStep(inputs.timeStep)} and ${engine.solverIterations} solver iterations, with g = ${scene.gravity} m/s², ${surfaces.join(", ")}.`,
    `Probes were sampled at ${inputs.rate} Hz; acceleration is a backward finite difference of velocity over one sample, and events are resolved to one step.`,
    `The run stopped ${stop}, at t = ${significant(run.stop.t)} s, within a ${inputs.protocol.maxTime} s limit.`,
    `Contact model: ${CONTACT_MODEL}`,
  ];
  const measured = comparisons.filter(
    (comparison) => comparison.measured !== undefined,
  );
  if (measured.length)
    sentences.push(
      `Compared with closed-form references: ${measured
        .map(
          ({ reference, measured: value }, index) =>
            `${reference.label.toLowerCase()} ${reference.symbol} = ${significant(value!)} ${reference.unit} against ${reference.formula} = ${significant(reference.value)} ${reference.unit} (Δ ${formatDelta(measured[index])}${reference.broken ? `; assumption broken: ${reference.broken}` : ""})`,
        )
        .join("; ")}.`,
    );
  if (convergence) {
    const steps = convergence.steps.map(formatStep).join(", ");
    sentences.push(
      convergence.change === undefined
        ? `A step check at ${steps} was inconclusive: ${convergence.note ?? "no value at every step"}`
        : `Halving the step twice (${steps}) changed ${convergence.label.toLowerCase()} by ${significant(convergence.change * 100, 2)} % between the two finest steps, ${convergence.passed ? "within" : "outside"} the ${convergence.tolerance * 100} % tolerance${convergence.order !== undefined ? `; observed order ${significant(convergence.order, 2)}` : `; ${(convergence.note ?? "").replace(/\.$/, "").toLowerCase()}`}.`,
    );
  }
  sentences.push(
    `Runs repeat exactly on the ${engine.reproducibility}. Run ${run.id}.`,
  );
  return sentences.join(" ");
}
