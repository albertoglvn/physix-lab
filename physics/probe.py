"""Line probes and closed-form references for the reference solution.

A line probe evaluates the stress components and von Mises along a straight segment. On the
FEM mesh each point takes the exact element value: the first triangle, in index order, whose
barycentric coordinates are all at least ``-CONTAINMENT_TOL`` is used, so points on a shared
edge read the lower-index element of the discontinuous field. Points outside every triangle
(holes, outside the part) are NaN. ``web/src/lab/stress/probe.ts`` uses the same rule and is
checked against ``tests/fixtures/line_probe_v1.json``.

The section resultant integrates the traction ``σ·n`` across the probe line, with ``n`` the
unit normal pointing towards the load edge, times the thickness. Across a cut that separates
the support from the load it equals the applied resultant force.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from physics.case import Case
from physics.geometry import load_segment
from physics.solver import ElementField, von_mises

CONTAINMENT_TOL = 1e-9
PROBE_COMPONENTS = ("sxx", "syy", "txy", "von_mises")
KIRSCH_KT = 3.0
# Points used for a section resultant; one sample spacing bounds the error at each crossing.
SECTION_SAMPLES = 1001


def line_points(a: Sequence[float], b: Sequence[float], n: int) -> np.ndarray:
    """``n`` evenly spaced points from ``a`` to ``b`` inclusive, shape (n, 2) in metres."""
    if n < 2:
        raise ValueError("A line probe needs at least two points.")
    ax, ay = float(a[0]), float(a[1])
    bx, by = float(b[0]), float(b[1])
    if ax == bx and ay == by:
        raise ValueError("A line probe needs two distinct end points.")
    t = np.linspace(0.0, 1.0, n)
    return np.column_stack([ax + t * (bx - ax), ay + t * (by - ay)])


def sample_exact(field: ElementField, points: np.ndarray) -> np.ndarray:
    """Element values at ``points``, shape (n, channels); NaN outside the mesh."""
    pts = np.asarray(points, dtype=float).reshape(-1, 2)
    p = field.points[field.triangles]  # (m, 3, 2)
    ax, ay = p[:, 0, 0], p[:, 0, 1]
    bx, by = p[:, 1, 0], p[:, 1, 1]
    cx, cy = p[:, 2, 0], p[:, 2, 1]
    det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    out = np.full((len(pts), field.values.shape[2]), np.nan)
    for n, (px, py) in enumerate(pts):
        l1 = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det
        l2 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det
        l0 = 1.0 - l1 - l2
        inside = np.flatnonzero(
            (l0 >= -CONTAINMENT_TOL) & (l1 >= -CONTAINMENT_TOL) & (l2 >= -CONTAINMENT_TOL)
        )
        if len(inside):
            e = inside[0]
            v = field.values[e]
            out[n] = l0[e] * v[0] + l1[e] * v[1] + l2[e] * v[2]
    return out


def probe_line(
    field: ElementField, a: Sequence[float], b: Sequence[float], n: int = 201
) -> dict[str, np.ndarray]:
    """Distance along the line (m), coordinates and the stress profile in Pa."""
    pts = line_points(a, b, n)
    s = sample_exact(field, pts)
    return {
        "s": np.hypot(pts[:, 0] - pts[0, 0], pts[:, 1] - pts[0, 1]),
        "x": pts[:, 0],
        "y": pts[:, 1],
        "sxx": s[:, 0],
        "syy": s[:, 1],
        "txy": s[:, 2],
        "von_mises": von_mises(s[:, 0], s[:, 1], s[:, 2]),
    }


def section_normal(case: Case, a: Sequence[float], b: Sequence[float]) -> np.ndarray:
    """Unit normal of the line ``a → b``, oriented towards the load edge's midpoint."""
    dx, dy = float(b[0]) - float(a[0]), float(b[1]) - float(a[1])
    length = np.hypot(dx, dy)
    n = np.array([dy, -dx]) / length
    seg = load_segment(case)
    mid = np.array([0.5 * (seg.x0 + seg.x1), 0.5 * (seg.y0 + seg.y1)])
    if float(n @ (mid - np.asarray(a, dtype=float))) < 0:
        n = -n
    return n


def section_resultant(case: Case, profile: dict[str, np.ndarray]) -> np.ndarray:
    """Force (N) carried across the probe line, by the trapezoid rule.

    Only intervals with both ends in the solid count, so an interval that crosses a hole or
    the outline adds nothing; the error is at most one sample spacing per crossing, which is
    why the resultant is taken on ``SECTION_SAMPLES`` points.
    """
    a = (profile["x"][0], profile["y"][0])
    b = (profile["x"][-1], profile["y"][-1])
    nx, ny = section_normal(case, a, b)
    tx = profile["sxx"] * nx + profile["txy"] * ny
    ty = profile["txy"] * nx + profile["syy"] * ny
    ds = np.diff(profile["s"])
    both = np.isfinite(tx[:-1]) & np.isfinite(tx[1:])
    fx = np.where(both, 0.5 * (tx[:-1] + tx[1:]) * ds, 0.0).sum()
    fy = np.where(both, 0.5 * (ty[:-1] + ty[1:]) * ds, 0.0).sum()
    return case.thickness * np.array([fx, fy])


def heywood_kt_net(d_over_w: float) -> float:
    """Heywood's finite-width factor for a central hole in tension, on the net section."""
    if not 0.0 <= d_over_w < 1.0:
        raise ValueError("d/W must lie in [0, 1).")
    return 2.0 + (1.0 - d_over_w) ** 3


def heywood_kt_gross(d_over_w: float) -> float:
    """The same factor on the gross section: Kt,net · W / (W − d)."""
    return heywood_kt_net(d_over_w) / (1.0 - d_over_w)
