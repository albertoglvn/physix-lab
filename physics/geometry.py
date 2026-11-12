"""Analytic geometry, boundary curves and geometric validation.

The signed distance function (SDF) defined here is negative inside the solid and positive
outside. Its exact formula is part of the feature-encoding contract: ``web/src/physics``
reimplements it in TypeScript and both sides are checked against a shared fixture.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from physics.case import Case, CaseValidationError

# Minimum clearance between a hole and any other boundary, as a fraction of the width.
MIN_CLEARANCE_REL = 0.01
# Smallest hole radius the reference mesh resolves reliably, as a fraction of the width.
MIN_HOLE_RADIUS_REL = 0.004


# --------------------------------------------------------------------------- SDF
def _box_sdf(px: np.ndarray, py: np.ndarray, x0: float, y0: float, x1: float, y1: float):
    cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
    hx, hy = 0.5 * (x1 - x0), 0.5 * (y1 - y0)
    qx = np.abs(px - cx) - hx
    qy = np.abs(py - cy) - hy
    outside = np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0))
    inside = np.minimum(np.maximum(qx, qy), 0.0)
    return outside + inside


def outer_sdf(case: Case, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Signed distance to the outer outline, ignoring holes."""
    g = case.geometry
    if case.family == "plate":
        return _box_sdf(px, py, 0.0, 0.0, g.width, g.height)
    a, b = g.web_width, g.flange_height
    rf = g.fillet_radius or 0.0
    assert a is not None and b is not None
    d = np.minimum(_box_sdf(px, py, 0.0, 0.0, a, g.height), _box_sdf(px, py, 0.0, 0.0, g.width, b))
    if rf > 0:
        fillet_box = _box_sdf(px, py, a, b, a + rf, b + rf)
        outside_circle = rf - np.hypot(px - (a + rf), py - (b + rf))
        d = np.minimum(d, np.maximum(fillet_box, outside_circle))
    return d


def signed_distance(case: Case, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Signed distance to the solid (negative inside), including holes."""
    d = outer_sdf(case, px, py)
    for h in case.geometry.holes:
        d = np.maximum(d, h.radius - np.hypot(px - h.x, py - h.y))
    return d


# -------------------------------------------------------------------- boundary curves
@dataclass(frozen=True)
class Segment:
    """A straight boundary segment with a boundary tag."""

    x0: float
    y0: float
    x1: float
    y1: float
    tag: str


@dataclass(frozen=True)
class Arc:
    """A circular arc from angle ``t0`` to ``t1`` (radians, signed sweep)."""

    cx: float
    cy: float
    r: float
    t0: float
    t1: float
    tag: str


Curve = Segment | Arc


def outer_curves(case: Case) -> list[Curve]:
    """Counter-clockwise outer boundary of the solid as tagged curves."""
    g = case.geometry
    w, h = g.width, g.height
    if case.family == "plate":
        return [
            Segment(0, 0, w, 0, "free"),
            Segment(w, 0, w, h, "load"),
            Segment(w, h, 0, h, "free"),
            Segment(0, h, 0, 0, "support"),
        ]
    a, b = g.web_width, g.flange_height
    rf = g.fillet_radius or 0.0
    assert a is not None and b is not None
    curves: list[Curve] = [
        Segment(0, 0, w, 0, "free"),
        Segment(w, 0, w, b, "load"),
        Segment(w, b, a + rf, b, "free"),
    ]
    if rf > 0:
        # Concave fillet: from (a + rf, b) to (a, b + rf), centre outside the solid.
        curves.append(Arc(a + rf, b + rf, rf, 1.5 * math.pi, math.pi, "fillet"))
    curves += [
        Segment(a, b + rf, a, h, "free"),
        Segment(a, h, 0, h, "support"),
        Segment(0, h, 0, 0, "free"),
    ]
    return curves


def hole_curves(case: Case) -> list[Arc]:
    """Clockwise hole boundaries, so the solid stays on the left."""
    return [
        Arc(hole.x, hole.y, hole.radius, 2 * math.pi, 0.0, f"hole{i}")
        for i, hole in enumerate(case.geometry.holes)
    ]


def curve_length(curve: Curve) -> float:
    if isinstance(curve, Segment):
        return math.hypot(curve.x1 - curve.x0, curve.y1 - curve.y0)
    return abs(curve.t1 - curve.t0) * curve.r


def curve_points(curve: Curve, n: int) -> np.ndarray:
    """Return ``n + 1`` points along the curve, including both end points."""
    s = np.linspace(0.0, 1.0, n + 1)
    if isinstance(curve, Segment):
        x = curve.x0 + s * (curve.x1 - curve.x0)
        y = curve.y0 + s * (curve.y1 - curve.y0)
    else:
        t = curve.t0 + s * (curve.t1 - curve.t0)
        x = curve.cx + curve.r * np.cos(t)
        y = curve.cy + curve.r * np.sin(t)
    return np.column_stack([x, y])


def support_segment(case: Case) -> Segment:
    return next(c for c in outer_curves(case) if c.tag == "support")  # type: ignore[return-value]


def load_segment(case: Case) -> Segment:
    return next(c for c in outer_curves(case) if c.tag == "load")  # type: ignore[return-value]


def distance_to_segment(seg: Segment, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    vx, vy = seg.x1 - seg.x0, seg.y1 - seg.y0
    length2 = vx * vx + vy * vy
    t = np.clip(((px - seg.x0) * vx + (py - seg.y0) * vy) / length2, 0.0, 1.0)
    return np.hypot(px - (seg.x0 + t * vx), py - (seg.y0 + t * vy))


def distance_to_outer_boundary(case: Case, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Exact Euclidean distance to the outer outline (sign-free)."""
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    d = np.full(np.broadcast(px, py).shape, np.inf)
    for curve in outer_curves(case):
        if isinstance(curve, Segment):
            d = np.minimum(d, distance_to_segment(curve, px, py))
        else:
            ang = np.arctan2(py - curve.cy, px - curve.cx) % (2 * math.pi)
            lo, hi = sorted((curve.t0 % (2 * math.pi), curve.t1 % (2 * math.pi)))
            if math.isclose(lo, hi):
                lo, hi = 0.0, 2 * math.pi
            on_arc = (ang >= lo) & (ang <= hi)
            radial = np.abs(np.hypot(px - curve.cx, py - curve.cy) - curve.r)
            ends = curve_points(curve, 1)
            end_d = np.minimum(
                np.hypot(px - ends[0, 0], py - ends[0, 1]),
                np.hypot(px - ends[1, 0], py - ends[1, 1]),
            )
            d = np.minimum(d, np.where(on_arc, radial, end_d))
    return d


# -------------------------------------------------------------------- validation
def validate_geometry(case: Case) -> None:
    g = case.geometry
    w, h = g.width, g.height
    clearance = MIN_CLEARANCE_REL * w

    if case.family == "bracket":
        a, b, rf = g.web_width, g.flange_height, g.fillet_radius
        assert a is not None and b is not None and rf is not None
        if not 0.05 * w <= a <= 0.8 * w:
            raise CaseValidationError(
                "geometry.web_width must lie in [0.05, 0.8] x width.", "geometry.web_width"
            )
        if not 0.05 * h <= b <= 0.8 * h:
            raise CaseValidationError(
                "geometry.flange_height must lie in [0.05, 0.8] x height.",
                "geometry.flange_height",
            )
        if not 0.0 <= rf <= 0.5 * min(w - a, h - b):
            raise CaseValidationError(
                "geometry.fillet_radius must lie in [0, 0.5 x min(width - web_width, "
                "height - flange_height)].",
                "geometry.fillet_radius",
            )

    for i, hole in enumerate(g.holes):
        path = f"geometry.holes[{i}]"
        if hole.radius < MIN_HOLE_RADIUS_REL * w:
            raise CaseValidationError(
                f"{path}.radius must be at least {MIN_HOLE_RADIUS_REL} x width.", path + ".radius"
            )
        px, py = np.array([hole.x]), np.array([hole.y])
        if outer_sdf(case, px, py)[0] >= 0:
            raise CaseValidationError(f"{path} centre lies outside the part.", path)
        ligament = distance_to_outer_boundary(case, px, py)[0] - hole.radius
        if ligament < clearance:
            raise CaseValidationError(
                f"{path} leaves a ligament of {ligament:.4g} m to the outer boundary; the "
                f"minimum clearance is {clearance:.4g} m (0.01 x width).",
                path,
            )
        for j, other in enumerate(g.holes[:i]):
            gap = math.hypot(hole.x - other.x, hole.y - other.y) - hole.radius - other.radius
            if gap < clearance:
                raise CaseValidationError(
                    f"{path} is within {gap:.4g} m of geometry.holes[{j}]; the minimum "
                    f"clearance is {clearance:.4g} m.",
                    path,
                )


def solid_area(case: Case) -> float:
    """Exact area of the solid in m^2."""
    g = case.geometry
    if case.family == "plate":
        area = g.width * g.height
    else:
        a, b, rf = g.web_width, g.flange_height, g.fillet_radius or 0.0
        assert a is not None and b is not None
        area = a * g.height + (g.width - a) * b + rf * rf * (1 - math.pi / 4)
    return area - sum(math.pi * hole.radius**2 for hole in g.holes)
