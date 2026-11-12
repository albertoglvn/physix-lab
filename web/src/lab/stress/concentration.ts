/**
 * Stress-concentration factor and its closed-form references; mirrors `physics/probe.py`.
 *
 * The measured factor uses the hotspot rule shared with the solver summary: the peak von Mises
 * stress over the solid, excluding the band within 5 % of the width from the clamped edge.
 */

import type { Case } from "../../physics/case";
import { traction, tractionMagnitude } from "../../physics/case";

export const KIRSCH_KT = 3;
export const HOTSPOT_RULE =
  "Peak von Mises over the solid, excluding 5 % of the width next to the clamped edge.";

/** Heywood's finite-width factor for a central hole in tension, on the net section. */
export function heywoodNet(dOverH: number): number {
  if (!(dOverH >= 0 && dOverH < 1)) throw new Error("d/H must lie in [0, 1).");
  return 2 + (1 - dOverH) ** 3;
}

/** The same factor on the gross section: Kt,net · H / (H − d). */
export function heywoodGross(dOverH: number): number {
  return heywoodNet(dOverH) / (1 - dOverH);
}

export type KtReferences =
  | {
      applicable: true;
      dOverH: number;
      kirsch: number;
      heywoodNet: number;
      heywoodGross: number;
    }
  | { applicable: false; reason: string };

/**
 * Closed-form references apply to a plate with one hole near mid-height, loaded along its
 * length, with the hole at least one plate height from either end.
 */
export function ktReferences(c: Case): KtReferences {
  const g = c.geometry;
  if (c.family !== "plate")
    return { applicable: false, reason: "References cover plates only." };
  if (g.holes.length !== 1)
    return { applicable: false, reason: "References cover a single hole." };
  const [tx, ty] = traction(c);
  if (Math.abs(ty) > 0.01 * Math.abs(tx) || tx === 0)
    return { applicable: false, reason: "References need axial tension." };
  const hole = g.holes[0];
  if (Math.abs(hole.y - 0.5 * g.height) > 0.05 * g.height)
    return { applicable: false, reason: "References need a centred hole." };
  if (Math.min(hole.x, g.width - hole.x) < g.height)
    return {
      applicable: false,
      reason: "The hole is within one plate height of an end.",
    };
  const dOverH = (2 * hole.radius) / g.height;
  if (dOverH > 0.6)
    return { applicable: false, reason: "References hold for d/H ≤ 0.6." };
  return {
    applicable: true,
    dOverH,
    kirsch: KIRSCH_KT,
    heywoodNet: heywoodNet(dOverH),
    heywoodGross: heywoodGross(dOverH),
  };
}

export interface MeasuredKt {
  /** Peak over the applied traction magnitude. */
  gross: number;
  /** Peak over the mean net-section stress; single-hole plates only. */
  net: number | null;
}

export function measuredKt(c: Case, peak: number): MeasuredKt | null {
  const t = tractionMagnitude(c);
  if (!(t > 0) || !Number.isFinite(peak)) return null;
  const g = c.geometry;
  const hole = c.family === "plate" && g.holes.length === 1 ? g.holes[0] : null;
  return {
    gross: peak / t,
    net: hole ? (peak * (g.height - 2 * hole.radius)) / (g.height * t) : null,
  };
}
