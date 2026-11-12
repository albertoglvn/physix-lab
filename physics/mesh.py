"""Deterministic boundary-conforming triangle meshing with tagged facets.

The mesher is a DistMesh-style generator (Persson and Strang, 2004) adapted for exact
boundary tags: boundary nodes are placed on each tagged curve and kept fixed, interior
nodes are seeded from a graded lattice and relaxed with a truss analogy, and the final
Delaunay triangulation is filtered against the discretised boundary polygon. The mesh is
checked for conformity, so every tagged boundary segment is an edge of the triangulation.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from scipy.spatial import Delaunay

from physics.case import Case
from physics.geometry import (
    Arc,
    Curve,
    curve_length,
    curve_points,
    hole_curves,
    outer_curves,
    signed_distance,
    support_segment,
)


class MeshError(RuntimeError):
    """The mesher could not build a valid conforming mesh."""


@dataclass(frozen=True)
class MeshSettings:
    """Mesh controls, all relative to the part width.

    ``h_max_rel``: largest element edge length.
    ``h_min_rel``: smallest edge length near holes, fillets and support corners.
    ``grading``: growth rate of the size function away from refined features.
    ``feature_points``: minimum boundary nodes on a full hole circle.
    ``element_order``: Lagrange order of the displacement field (1 or 2).
    """

    h_max_rel: float = 1 / 40
    h_min_rel: float = 1 / 200
    grading: float = 0.3
    feature_points: int = 64
    element_order: int = 2
    relax_iterations: int = 40
    seed: int = 0

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)

    def refined(self, factor: float = 1.5) -> MeshSettings:
        return MeshSettings(
            h_max_rel=self.h_max_rel / factor,
            h_min_rel=self.h_min_rel / factor,
            grading=self.grading,
            feature_points=int(round(self.feature_points * factor)),
            element_order=self.element_order,
            relax_iterations=self.relax_iterations,
            seed=self.seed,
        )


MESH_PRESETS: dict[str, MeshSettings] = {
    # Interactive previews and active-learning fallbacks.
    "fast": MeshSettings(h_max_rel=1 / 28, h_min_rel=1 / 120, feature_points=40),
    # Dataset labels and verification; see docs/PHYSICS.md for its convergence study.
    "reference": MeshSettings(),
    # Convergence checks.
    "fine": MeshSettings(h_max_rel=1 / 64, h_min_rel=1 / 320, feature_points=104),
}


@dataclass
class TaggedMesh:
    """Triangle mesh with boundary segments grouped by tag.

    ``points``: (n, 2) node coordinates in metres.
    ``triangles``: (m, 3) counter-clockwise node indices.
    ``boundary_edges``: tag -> (k, 2) node index pairs of tagged boundary segments.
    """

    points: np.ndarray
    triangles: np.ndarray
    boundary_edges: dict[str, np.ndarray]

    @property
    def n_nodes(self) -> int:
        return int(self.points.shape[0])

    @property
    def n_elements(self) -> int:
        return int(self.triangles.shape[0])

    def quality(self) -> dict[str, float]:
        p = self.points[self.triangles]
        angles = []
        for k in range(3):
            a = p[:, (k + 1) % 3] - p[:, k]
            b = p[:, (k + 2) % 3] - p[:, k]
            cos = np.einsum("ij,ij->i", a, b) / (
                np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)
            )
            angles.append(np.degrees(np.arccos(np.clip(cos, -1, 1))))
        ang = np.stack(angles, axis=1)
        return {"min_angle_deg": float(ang.min()), "mean_min_angle_deg": float(ang.min(1).mean())}


# ----------------------------------------------------------------- size function
def _size_function(case: Case, s: MeshSettings):
    w = case.geometry.width
    h_max = s.h_max_rel * w
    h_min = s.h_min_rel * w
    features: list[tuple[str, tuple[float, ...], float]] = []
    for hole in case.geometry.holes:
        target = max(h_min, min(h_max, 2 * math.pi * hole.radius / s.feature_points))
        features.append(("circle", (hole.x, hole.y, hole.radius), target))
    for curve in outer_curves(case):
        if isinstance(curve, Arc):
            target = max(h_min, min(h_max, 2 * math.pi * curve.r / s.feature_points))
            features.append(("circle", (curve.cx, curve.cy, curve.r), target))
    sup = support_segment(case)
    for x, y in ((sup.x0, sup.y0), (sup.x1, sup.y1)):
        features.append(("point", (x, y), max(h_min, 0.5 * h_max)))
    if case.family == "bracket":
        g = case.geometry
        assert g.web_width is not None and g.flange_height is not None
        rf = g.fillet_radius or 0.0
        if rf == 0:
            features.append(("point", (g.web_width, g.flange_height), h_min))

    def size(px: np.ndarray, py: np.ndarray) -> np.ndarray:
        out = np.full(np.shape(px), h_max, dtype=float)
        for kind, params, target in features:
            if kind == "circle":
                cx, cy, r = params
                d = np.abs(np.hypot(px - cx, py - cy) - r)
            else:
                cx, cy = params
                d = np.hypot(px - cx, py - cy)
            out = np.minimum(out, target + s.grading * d)
        return out

    return size


# --------------------------------------------------------------- boundary sampling
def _sample_loop(curves: list[Curve], size) -> tuple[np.ndarray, list[str]]:
    """Sample a closed loop of curves. Returns points and the tag of each segment."""
    pts: list[np.ndarray] = []
    tags: list[str] = []
    for curve in curves:
        probe = curve_points(curve, 16)
        h_local = float(np.min(size(probe[:, 0], probe[:, 1])))
        n = max(1 if not isinstance(curve, Arc) else 3, math.ceil(curve_length(curve) / h_local))
        if isinstance(curve, Arc) and abs(curve.t1 - curve.t0) >= 2 * math.pi - 1e-12:
            n = max(n, 12)
        # Refine graded straight segments: subdivide by local size along the segment.
        sp = _graded_params(curve, size, n)
        cp = _points_at(curve, sp)
        pts.append(cp[:-1])
        tags.extend([curve.tag] * (len(cp) - 1))
    return np.vstack(pts), tags


def _points_at(curve: Curve, s: np.ndarray) -> np.ndarray:
    if isinstance(curve, Arc):
        t = curve.t0 + s * (curve.t1 - curve.t0)
        return np.column_stack([curve.cx + curve.r * np.cos(t), curve.cy + curve.r * np.sin(t)])
    return np.column_stack(
        [curve.x0 + s * (curve.x1 - curve.x0), curve.y0 + s * (curve.y1 - curve.y0)]
    )


def _graded_params(curve: Curve, size, n_min: int) -> np.ndarray:
    """Parameters in [0, 1] whose spacing follows the size function."""
    fine = np.linspace(0.0, 1.0, 400)
    p = _points_at(curve, fine)
    density = 1.0 / size(p[:, 0], p[:, 1])
    cumulative = np.concatenate([[0.0], np.cumsum(0.5 * (density[1:] + density[:-1]))])
    cumulative *= curve_length(curve) / (len(fine) - 1)
    n = max(n_min, int(math.ceil(cumulative[-1])))
    targets = np.linspace(0.0, cumulative[-1], n + 1)
    return np.interp(targets, cumulative, fine)


# --------------------------------------------------------------- inside polygon test
def _points_in_polygons(px: np.ndarray, py: np.ndarray, segs: np.ndarray) -> np.ndarray:
    """Even-odd test against all boundary segments (outer loop plus hole loops)."""
    inside = np.zeros(px.shape, dtype=bool)
    x0, y0, x1, y1 = segs.T
    chunk = 2048
    for start in range(0, len(px), chunk):
        qx = px[start : start + chunk, None]
        qy = py[start : start + chunk, None]
        crosses = (y0 > qy) != (y1 > qy)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = x0 + (qy - y0) * (x1 - x0) / (y1 - y0)
        hit = crosses & (qx < xint)
        inside[start : start + chunk] = np.count_nonzero(hit, axis=1) % 2 == 1
    return inside


# ----------------------------------------------------------------------- mesher
def build_mesh(case: Case, settings: MeshSettings | None = None) -> TaggedMesh:
    s = settings or MESH_PRESETS["reference"]
    size = _size_function(case, s)
    w = case.geometry.width

    loops = [outer_curves(case)] + [[arc] for arc in hole_curves(case)]
    fixed_pts: list[np.ndarray] = []
    seg_index: list[np.ndarray] = []
    seg_tags: list[str] = []
    offset = 0
    for loop in loops:
        pts, tags = _sample_loop(loop, size)
        n = len(pts)
        idx = offset + np.arange(n)
        seg_index.append(np.column_stack([idx, np.roll(idx, -1)]))
        seg_tags.extend(tags)
        fixed_pts.append(pts)
        offset += n
    fixed = np.vstack(fixed_pts)
    segments = np.vstack(seg_index)
    n_fixed = len(fixed)
    seg_coords = np.column_stack([fixed[segments[:, 0]], fixed[segments[:, 1]]])

    # Interior seeds: graded hexagonal lattice with deterministic rejection sampling.
    g = case.geometry
    h0 = s.h_min_rel * w
    xs = np.arange(0.0, g.width + h0, h0)
    ys = np.arange(0.0, g.height + h0, h0 * math.sqrt(3) / 2)
    gx, gy = np.meshgrid(xs, ys)
    gx = gx + (np.arange(len(ys))[:, None] % 2) * h0 / 2
    gx, gy = gx.ravel(), gy.ravel()
    hloc = size(gx, gy)
    keep = signed_distance(case, gx, gy) < -0.45 * hloc
    gx, gy, hloc = gx[keep], gy[keep], hloc[keep]
    rng = np.random.default_rng(s.seed)
    keep = rng.random(len(gx)) < (h0 / hloc) ** 2
    interior = np.column_stack([gx[keep], gy[keep]])
    if len(interior) == 0:
        raise MeshError("Mesh settings leave no interior nodes.")

    def inside_tris(pts: np.ndarray) -> np.ndarray:
        tri = Delaunay(pts).simplices
        c = pts[tri].mean(axis=1)
        mask = _points_in_polygons(c[:, 0], c[:, 1], seg_coords)
        return tri[mask]

    # Truss relaxation of interior nodes (fixed boundary nodes do not move).
    pts = np.vstack([fixed, interior])
    for _ in range(s.relax_iterations):
        tri = inside_tris(pts)
        bars = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
        bars = np.unique(np.sort(bars, axis=1), axis=0)
        vec = pts[bars[:, 0]] - pts[bars[:, 1]]
        length = np.linalg.norm(vec, axis=1)
        mid = 0.5 * (pts[bars[:, 0]] + pts[bars[:, 1]])
        hbar = size(mid[:, 0], mid[:, 1])
        l0 = hbar * 1.2 * math.sqrt(np.sum(length**2) / np.sum(hbar**2))
        force = np.maximum(l0 - length, 0.0) / length
        fvec = vec * force[:, None]
        total = np.zeros_like(pts)
        np.add.at(total, bars[:, 0], fvec)
        np.add.at(total, bars[:, 1], -fvec)
        total[:n_fixed] = 0.0
        pts = pts + 0.2 * total
        # Keep interior nodes a safe distance inside the solid.
        ip = pts[n_fixed:]
        hl = size(ip[:, 0], ip[:, 1])
        d = signed_distance(case, ip[:, 0], ip[:, 1])
        bad = d > -0.3 * hl
        if np.any(bad):
            eps = 1e-6 * w
            bp = ip[bad]
            gxp = (
                signed_distance(case, bp[:, 0] + eps, bp[:, 1])
                - signed_distance(case, bp[:, 0] - eps, bp[:, 1])
            ) / (2 * eps)
            gyp = (
                signed_distance(case, bp[:, 0], bp[:, 1] + eps)
                - signed_distance(case, bp[:, 0], bp[:, 1] - eps)
            ) / (2 * eps)
            norm = np.hypot(gxp, gyp) + 1e-30
            shift = d[bad] + 0.3 * hl[bad]
            bp = bp - np.column_stack([gxp, gyp]) * (shift / norm)[:, None]
            ip[bad] = bp
            pts[n_fixed:] = ip

    # Drop interior nodes that collapsed onto each other or onto the boundary.
    ip = pts[n_fixed:]
    hl = size(ip[:, 0], ip[:, 1])
    ok = signed_distance(case, ip[:, 0], ip[:, 1]) < -0.2 * hl
    pts = np.vstack([fixed, ip[ok]])

    tri = inside_tris(pts)
    # Remove zero-area triangles formed by collinear boundary nodes.
    p = pts[tri]
    area = 0.5 * (
        (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1])
        - (p[:, 2, 0] - p[:, 0, 0]) * (p[:, 1, 1] - p[:, 0, 1])
    )
    tri = tri[np.abs(area) > 1e-10 * (s.h_min_rel * w) ** 2]
    area = area[np.abs(area) > 1e-10 * (s.h_min_rel * w) ** 2]
    tri[area < 0] = tri[area < 0][:, [0, 2, 1]]

    # Remove unused nodes and renumber.
    used = np.unique(tri)
    if not np.all(np.isin(np.arange(n_fixed), used)):
        raise MeshError("A boundary node is not attached to any element.")
    remap = -np.ones(len(pts), dtype=np.int64)
    remap[used] = np.arange(len(used))
    pts = pts[used]
    tri = remap[tri]
    segments = remap[segments]

    _check_conformity(tri, segments)

    boundary: dict[str, list[np.ndarray]] = {}
    for seg, tag in zip(segments, seg_tags, strict=True):
        boundary.setdefault(tag, []).append(seg)
    mesh = TaggedMesh(
        points=pts,
        triangles=tri.astype(np.int64),
        boundary_edges={k: np.array(v, dtype=np.int64) for k, v in boundary.items()},
    )
    q = mesh.quality()
    if q["min_angle_deg"] < 5.0:
        raise MeshError(f"Mesh quality too low (minimum angle {q['min_angle_deg']:.1f} deg).")
    return mesh


def _check_conformity(tri: np.ndarray, segments: np.ndarray) -> None:
    edges = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    edges = np.sort(edges, axis=1)
    keys, counts = np.unique(edges[:, 0] * (tri.max() + 1) + edges[:, 1], return_counts=True)
    seg = np.sort(segments, axis=1)
    seg_keys = seg[:, 0] * (tri.max() + 1) + seg[:, 1]
    present = np.isin(seg_keys, keys)
    if not np.all(present):
        raise MeshError(f"{np.count_nonzero(~present)} boundary segments are not mesh edges.")
    boundary_keys = keys[counts == 1]
    if len(boundary_keys) != len(seg_keys) or not np.all(np.isin(boundary_keys, seg_keys)):
        raise MeshError("Mesh boundary does not match the tagged boundary loops.")
