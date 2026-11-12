/** Signed distances and boundary segments; mirrors `physics/geometry.py`. */

import type { Case } from "./case";

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tag: string;
}

export interface Arc {
  cx: number;
  cy: number;
  r: number;
  t0: number;
  t1: number;
  tag: string;
}

export type Curve = Segment | Arc;

const isArc = (c: Curve): c is Arc => "r" in c;

function boxSdf(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const cx = 0.5 * (x0 + x1);
  const cy = 0.5 * (y0 + y1);
  const hx = 0.5 * (x1 - x0);
  const hy = 0.5 * (y1 - y0);
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside;
}

export function outerSdf(c: Case, px: number, py: number): number {
  const g = c.geometry;
  if (c.family === "plate") return boxSdf(px, py, 0, 0, g.width, g.height);
  const a = g.web_width ?? 0;
  const b = g.flange_height ?? 0;
  const rf = g.fillet_radius ?? 0;
  let d = Math.min(
    boxSdf(px, py, 0, 0, a, g.height),
    boxSdf(px, py, 0, 0, g.width, b),
  );
  if (rf > 0) {
    const fillet = boxSdf(px, py, a, b, a + rf, b + rf);
    const outsideCircle = rf - Math.hypot(px - (a + rf), py - (b + rf));
    d = Math.min(d, Math.max(fillet, outsideCircle));
  }
  return d;
}

/** Signed distance to the solid (negative inside), including holes. */
export function signedDistance(c: Case, px: number, py: number): number {
  let d = outerSdf(c, px, py);
  for (const h of c.geometry.holes)
    d = Math.max(d, h.radius - Math.hypot(px - h.x, py - h.y));
  return d;
}

export function outerCurves(c: Case): Curve[] {
  const g = c.geometry;
  const w = g.width;
  const h = g.height;
  if (c.family === "plate") {
    return [
      { x0: 0, y0: 0, x1: w, y1: 0, tag: "free" },
      { x0: w, y0: 0, x1: w, y1: h, tag: "load" },
      { x0: w, y0: h, x1: 0, y1: h, tag: "free" },
      { x0: 0, y0: h, x1: 0, y1: 0, tag: "support" },
    ];
  }
  const a = g.web_width ?? 0;
  const b = g.flange_height ?? 0;
  const rf = g.fillet_radius ?? 0;
  const curves: Curve[] = [
    { x0: 0, y0: 0, x1: w, y1: 0, tag: "free" },
    { x0: w, y0: 0, x1: w, y1: b, tag: "load" },
    { x0: w, y0: b, x1: a + rf, y1: b, tag: "free" },
  ];
  if (rf > 0)
    curves.push({
      cx: a + rf,
      cy: b + rf,
      r: rf,
      t0: 1.5 * Math.PI,
      t1: Math.PI,
      tag: "fillet",
    });
  curves.push(
    { x0: a, y0: b + rf, x1: a, y1: h, tag: "free" },
    { x0: a, y0: h, x1: 0, y1: h, tag: "support" },
    { x0: 0, y0: h, x1: 0, y1: 0, tag: "free" },
  );
  return curves;
}

export function supportSegment(c: Case): Segment {
  return outerCurves(c).find((s) => s.tag === "support") as Segment;
}

export function loadSegment(c: Case): Segment {
  return outerCurves(c).find((s) => s.tag === "load") as Segment;
}

export function distanceToSegment(s: Segment, px: number, py: number): number {
  const vx = s.x1 - s.x0;
  const vy = s.y1 - s.y0;
  const l2 = vx * vx + vy * vy;
  const t = Math.min(
    1,
    Math.max(0, ((px - s.x0) * vx + (py - s.y0) * vy) / l2),
  );
  return Math.hypot(px - (s.x0 + t * vx), py - (s.y0 + t * vy));
}

const TAU = 2 * Math.PI;
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Exact Euclidean distance to the outer outline. */
export function distanceToOuterBoundary(
  c: Case,
  px: number,
  py: number,
): number {
  let d = Infinity;
  for (const curve of outerCurves(c)) {
    if (!isArc(curve)) {
      d = Math.min(d, distanceToSegment(curve, px, py));
      continue;
    }
    const ang = mod(Math.atan2(py - curve.cy, px - curve.cx), TAU);
    let lo = Math.min(mod(curve.t0, TAU), mod(curve.t1, TAU));
    let hi = Math.max(mod(curve.t0, TAU), mod(curve.t1, TAU));
    if (Math.abs(lo - hi) < 1e-12) {
      lo = 0;
      hi = TAU;
    }
    const onArc = ang >= lo && ang <= hi;
    const radial = Math.abs(Math.hypot(px - curve.cx, py - curve.cy) - curve.r);
    const e0x = curve.cx + curve.r * Math.cos(curve.t0);
    const e0y = curve.cy + curve.r * Math.sin(curve.t0);
    const e1x = curve.cx + curve.r * Math.cos(curve.t1);
    const e1y = curve.cy + curve.r * Math.sin(curve.t1);
    const endD = Math.min(
      Math.hypot(px - e0x, py - e0y),
      Math.hypot(px - e1x, py - e1y),
    );
    d = Math.min(d, onArc ? radial : endD);
  }
  return d;
}

/** SVG path of the outer outline in metres (y up; flip in the view transform). */
export function outlinePath(c: Case): string {
  const parts: string[] = [];
  outerCurves(c).forEach((curve, k) => {
    if (isArc(curve)) {
      const x1 = curve.cx + curve.r * Math.cos(curve.t1);
      const y1 = curve.cy + curve.r * Math.sin(curve.t1);
      const sweep = curve.t1 > curve.t0 ? 1 : 0;
      parts.push(`A ${curve.r} ${curve.r} 0 0 ${sweep} ${x1} ${y1}`);
    } else {
      if (k === 0) parts.push(`M ${curve.x0} ${curve.y0}`);
      parts.push(`L ${curve.x1} ${curve.y1}`);
    }
  });
  parts.push("Z");
  return parts.join(" ");
}

export interface GeometryIssue {
  field: string;
  message: string;
}

/** Fast client-side sanity checks; the server's validation is authoritative. */
export function geometryIssues(c: Case): GeometryIssue[] {
  const g = c.geometry;
  const issues: GeometryIssue[] = [];
  const w = g.width;
  if (!(w > 0) || !(g.height > 0))
    issues.push({
      field: "geometry",
      message: "Width and height must be positive.",
    });
  if (!(c.thickness > 0))
    issues.push({ field: "thickness", message: "Thickness must be positive." });
  if (c.family === "bracket") {
    const a = g.web_width ?? 0;
    const b = g.flange_height ?? 0;
    const rf = g.fillet_radius ?? 0;
    if (!(a > 0 && a + rf < w))
      issues.push({
        field: "geometry.web_width",
        message: "Web must be narrower than the bracket.",
      });
    if (!(b > 0 && b + rf < g.height))
      issues.push({
        field: "geometry.flange_height",
        message: "Flange must be lower than the bracket.",
      });
  }
  g.holes.forEach((h, i) => {
    if (!(h.radius > 0))
      issues.push({
        field: `geometry.holes[${i}]`,
        message: `Hole ${i + 1} needs a positive radius.`,
      });
    else if (outerSdf(c, h.x, h.y) > -(h.radius + 0.01 * w))
      issues.push({
        field: `geometry.holes[${i}]`,
        message: `Hole ${i + 1} is too close to or outside the outline.`,
      });
    g.holes.slice(0, i).forEach((o, j) => {
      if (Math.hypot(h.x - o.x, h.y - o.y) < h.radius + o.radius + 0.01 * w)
        issues.push({
          field: `geometry.holes[${i}]`,
          message: `Holes ${j + 1} and ${i + 1} overlap.`,
        });
    });
  });
  return issues;
}
