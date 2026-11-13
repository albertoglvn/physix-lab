/**
 * Helpers for the mesh convergence study: probe choice, labels, methods text and CSV. The
 * study itself runs in the solver (physics/convergence.py) and returns `physix.convergence/1`.
 */

import type {
  ConvergenceKind,
  ConvergenceResponse,
  MeshPreset,
} from "../../api/client";
import type { Case } from "../../physics/case";
import { signedDistance } from "../../physics/geometry";
import type { ProbeLine } from "./probe";

/** Probes at a quarter, half and three quarters along the line, kept when inside the solid. */
export const PROBE_FRACTIONS = [0.25, 0.5, 0.75] as const;
/** A probe this close to a boundary, relative to the width, is dropped as mesh-sensitive. */
export const PROBE_CLEARANCE_REL = 0.02;

export const PRESET_LABELS: Record<MeshPreset, string> = {
  fast: "Coarse",
  reference: "Medium",
  fine: "Fine",
};

export const KIND_LABELS: Record<ConvergenceKind, string> = {
  monotonic: "Monotonic convergence",
  oscillatory: "Oscillatory convergence",
  divergent: "Not converging",
  converged: "No change between the finest levels",
};

export function studyProbes(
  c: Case,
  line: ProbeLine,
): { x: number; y: number }[] {
  const clearance = PROBE_CLEARANCE_REL * c.geometry.width;
  return PROBE_FRACTIONS.flatMap((t) => {
    const x = line.a[0] + t * (line.b[0] - line.a[0]);
    const y = line.a[1] + t * (line.b[1] - line.a[1]);
    return signedDistance(c, x, y) < -clearance ? [{ x, y }] : [];
  });
}

const sig = (value: number, digits = 4) => Number(value.toPrecision(digits));
const mpa = (pa: number) => `${sig(pa / 1e6)} MPa`;
const percent = (fraction: number) => `${sig(fraction * 100, 2)}%`;

/** The finest level that passed, or undefined. */
export function promotedLevel(study: ConvergenceResponse) {
  return study.levels.find((level) => level.preset === study.promoted);
}

/** A paragraph a student can paste into a report. */
export function convergenceMethods(study: ConvergenceResponse): string {
  const fine = study.levels[study.levels.length - 1];
  const fit = study.hotspot;
  const sizes = study.levels
    .map(
      (level) =>
        `${PRESET_LABELS[level.preset].toLowerCase()} (${level.elements} elements, h = ${sig(level.element_size * 1e3, 3)} mm)`,
    )
    .join(", ");
  const sentences = [
    `The hotspot von Mises stress was solved with ${study.solver.name} ${study.solver.version} on ${study.solver.element} meshes at three levels: ${sizes}, where h is the square root of the solid area per element.`,
    `Neighbouring levels were compared by the hotspot change and the relative L2 change of von Mises stress on a probe grid inside the solid, with ${percent(study.hotspot_tolerance)} tolerances.`,
  ];
  if (fit.kind === "monotonic" && fit.extrapolated !== null)
    sentences.push(
      `The hotspot converged monotonically with an observed order of ${fit.order === null ? "—" : sig(fit.order, 3)}${fit.order !== null && fit.order_used !== null && fit.order_used < fit.order ? `, capped at the formal order ${fit.order_used} for the error band` : ""}. Richardson extrapolation gave ${mpa(fit.extrapolated)}, against ${mpa(fine.hotspot.von_mises)} on the fine mesh, with a fine-grid convergence index of ${percent(fit.gci_fine)} (safety factor ${fit.safety_factor}).`,
    );
  else if (fit.kind === "converged")
    sentences.push(
      `The hotspot did not change between the two finest levels, so no extrapolation was needed.`,
    );
  else
    sentences.push(
      `The hotspot changes were ${fit.kind === "oscillatory" ? "oscillatory" : "not decreasing"}, so no extrapolation is reported; the fine-grid convergence index of ${percent(fit.gci_fine)} uses the formal order ${fit.order_used} and a safety factor of ${fit.safety_factor}.`,
    );
  const promoted = promotedLevel(study);
  sentences.push(
    promoted
      ? `The ${PRESET_LABELS[promoted.preset].toLowerCase()} mesh was the finest level within tolerance and was used as the reference.`
      : "No level met the tolerances, so no mesh was promoted as the reference.",
  );
  return sentences.join(" ");
}

export const CONVERGENCE_CSV_COLUMNS = [
  "preset",
  "nodes",
  "elements",
  "element_size",
  "hotspot",
  "hotspot_change_to_finer",
  "field_change_to_finer",
  "passes",
  "solve_ms",
] as const;

const cell = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : String(value);

/** One row per level in SI units, then the probes; `#` lines give the fit and the rule. */
export function convergenceCsv(study: ConvergenceResponse): string {
  const fit = study.hotspot;
  const lines = [
    `# ${study.schema} ${study.case_id}`,
    `# solver: ${study.solver.name} ${study.solver.version}, ${study.solver.element}`,
    `# hotspot_rule: ${study.hotspot_rule}`,
    `# units: element_size m, hotspot Pa, changes relative`,
    `# tolerances: hotspot ${study.hotspot_tolerance}, field ${study.field_tolerance}`,
    `# richardson: kind ${fit.kind}, order ${cell(fit.order)}, order_used ${cell(fit.order_used)}, extrapolated ${cell(fit.extrapolated)}, gci_fine ${cell(fit.gci_fine)}, safety_factor ${fit.safety_factor}`,
    `# promoted: ${study.promoted ?? "none"}`,
    CONVERGENCE_CSV_COLUMNS.join(","),
  ];
  for (const level of study.levels)
    lines.push(
      [
        level.preset,
        level.nodes,
        level.elements,
        cell(level.element_size),
        cell(level.hotspot.von_mises),
        cell(level.to_finer?.hotspot_rel),
        cell(level.to_finer?.field_rel_l2),
        level.passes,
        cell(level.solve_ms),
      ].join(","),
    );
  study.probes.forEach((probe, k) => {
    lines.push(
      `# probe ${k + 1} at (${probe.x}, ${probe.y}) m: ${study.levels.map((level) => cell(level.probes[k])).join(" ")} Pa coarse to fine; kind ${probe.kind}, extrapolated ${cell(probe.extrapolated)}, gci_fine ${cell(probe.gci_fine)}`,
    );
  });
  return `${lines.join("\n")}\n`;
}
