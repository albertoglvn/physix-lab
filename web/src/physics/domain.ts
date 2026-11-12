/**
 * Training-domain check and fallback decision; mirrors `data/domain.py::check_domain` and
 * `model/calibrate.py::decide`. The domain and policy come from the model manifest, so the
 * browser always applies the thresholds versioned with the weights it runs.
 */

import type { Case } from "./case";
import { fitsFrame } from "./encoding";
import { distanceToOuterBoundary } from "./geometry";

type Range = [number, number];

export interface FamilyDomain {
  aspect: Range;
  holes: Range;
  hole_radius_rel: Range;
  web_width_rel?: Range;
  flange_height_rel_height?: Range;
  fillet_radius_rel?: Range;
}

export interface Domain {
  version: string;
  support: string[];
  poisson: Range;
  hole_clearance_rel: number;
  plate: FamilyDomain;
  bracket: FamilyDomain;
}

export interface FallbackPolicy {
  schema?: string;
  metric?: string;
  threshold: number;
  requires_in_domain?: boolean;
  target?: { hotspot_error_quantile: number; max_hotspot_error: number };
  calibration?: Record<string, number | null>;
  test?: Record<string, number | null>;
}

export interface DomainCheck {
  in_domain: boolean;
  reasons: string[];
}

const EPS = 1e-9;
const within = (v: number, [lo, hi]: Range) => lo - EPS <= v && v <= hi + EPS;
const fmt = (v: number) => Number(v.toPrecision(3)).toString();

export function checkDomain(c: Case, d: Domain): DomainCheck {
  const reasons: string[] = [];
  const g = c.geometry;
  const w = g.width;
  const fam = d[c.family];
  if (!fam) return { in_domain: false, reasons: [`family '${c.family}' is not in the training domain`] };
  if (!d.support.includes(c.support)) reasons.push(`support '${c.support}' is not in the training domain`);
  if (!within(c.material.poisson, d.poisson))
    reasons.push(`poisson ${fmt(c.material.poisson)} outside [${d.poisson.join(", ")}]`);
  if (!fitsFrame(c)) reasons.push("height exceeds the raster frame (0.5 x width)");
  const aspect = g.height / w;
  if (!within(aspect, fam.aspect)) reasons.push(`height/width ${fmt(aspect)} outside [${fam.aspect.join(", ")}]`);
  const n = g.holes.length;
  if (!(fam.holes[0] <= n && n <= fam.holes[1])) reasons.push(`${n} holes outside the trained range [${fam.holes.join(", ")}]`);
  g.holes.forEach((h, i) => {
    const r = h.radius / w;
    if (!within(r, fam.hole_radius_rel))
      reasons.push(`hole ${i} radius/width ${fmt(r)} outside [${fam.hole_radius_rel.join(", ")}]`);
    const lig = distanceToOuterBoundary(c, h.x, h.y);
    if ((lig - h.radius) / w < d.hole_clearance_rel - EPS)
      reasons.push(`hole ${i} is closer to the outline than the trained clearance`);
    g.holes.slice(0, i).forEach((o, j) => {
      const gap = Math.hypot(h.x - o.x, h.y - o.y) - h.radius - o.radius;
      if (gap / w < d.hole_clearance_rel - EPS) reasons.push(`holes ${j} and ${i} are closer than the trained clearance`);
    });
  });
  if (c.family === "bracket") {
    if (fam.web_width_rel && !within((g.web_width ?? 0) / w, fam.web_width_rel))
      reasons.push("web_width outside the trained range");
    if (fam.flange_height_rel_height && !within((g.flange_height ?? 0) / g.height, fam.flange_height_rel_height))
      reasons.push("flange_height outside the trained range");
    if (fam.fillet_radius_rel && !within((g.fillet_radius ?? 0) / w, fam.fillet_radius_rel))
      reasons.push("fillet_radius outside the trained range");
  }
  return { in_domain: reasons.length === 0, reasons };
}

export type FallbackReason = "out_of_domain" | "non_finite_prediction" | "high_disagreement" | null;

export function decide(policy: FallbackPolicy, disagreement: number, inDomain: boolean): [boolean, FallbackReason] {
  if (!inDomain && policy.requires_in_domain !== false) return [false, "out_of_domain"];
  if (!Number.isFinite(disagreement)) return [false, "non_finite_prediction"];
  if (disagreement > policy.threshold) return [false, "high_disagreement"];
  return [true, null];
}
