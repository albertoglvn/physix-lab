"""Mesh convergence checks with explicit metrics and tolerances.

Metrics compare a solve against a refined solve of the identical case:

* ``hotspot_rel``: relative change of the hotspot von Mises stress (see
  :data:`physics.solver.HOTSPOT_EXCLUSION_REL`).
* ``field_rel_l2``: relative L2 change of von Mises stress sampled on a regular probe grid
  inside the solid, excluding a band of 0.02 x width next to every boundary (where the
  polygonal boundary approximation differs between meshes).

A solve qualifies as a reference when both metrics are within tolerance.

:func:`convergence_study` solves at three mesh presets, applies these checks between
neighbouring levels and reports Richardson extrapolation and the grid convergence index.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass

import numpy as np

from physics.case import Case
from physics.geometry import signed_distance
from physics.mesh import MESH_PRESETS, MeshSettings
from physics.solver import Solution, solve, von_mises

HOTSPOT_TOLERANCE = 0.02
FIELD_TOLERANCE = 0.02
PROBE_MARGIN_REL = 0.02


@dataclass(frozen=True)
class ConvergenceReport:
    hotspot_rel: float
    field_rel_l2: float
    coarse_nodes: int
    fine_nodes: int
    hotspot_tolerance: float = HOTSPOT_TOLERANCE
    field_tolerance: float = FIELD_TOLERANCE

    @property
    def converged(self) -> bool:
        return self.hotspot_rel <= self.hotspot_tolerance and (
            self.field_rel_l2 <= self.field_tolerance
        )

    def to_dict(self) -> dict[str, float | int | bool]:
        return {
            "hotspot_rel": self.hotspot_rel,
            "field_rel_l2": self.field_rel_l2,
            "coarse_nodes": self.coarse_nodes,
            "fine_nodes": self.fine_nodes,
            "hotspot_tolerance": self.hotspot_tolerance,
            "field_tolerance": self.field_tolerance,
            "converged": self.converged,
        }


def probe_points(case: Case, n: int = 96) -> tuple[np.ndarray, np.ndarray]:
    g = case.geometry
    xs = (np.arange(n) + 0.5) / n * g.width
    ys = (np.arange(max(2, int(n * g.height / g.width))) + 0.5) * (g.width / n)
    px, py = np.meshgrid(xs, ys[ys < g.height])
    px, py = px.ravel(), py.ravel()
    keep = signed_distance(case, px, py) < -PROBE_MARGIN_REL * g.width
    return px[keep], py[keep]


def compare(coarse: Solution, fine: Solution) -> ConvergenceReport:
    case = coarse.case
    px, py = probe_points(case)
    a = coarse.stress.sample(px, py)
    b = fine.stress.sample(px, py)
    vm_a = von_mises(a[:, 0], a[:, 1], a[:, 2])
    vm_b = von_mises(b[:, 0], b[:, 1], b[:, 2])
    field = float(np.linalg.norm(vm_a - vm_b) / max(np.linalg.norm(vm_b), 1e-30))
    ha = coarse.hotspot()["von_mises"]
    hb = fine.hotspot()["von_mises"]
    return ConvergenceReport(
        hotspot_rel=abs(ha - hb) / max(abs(hb), 1e-30),
        field_rel_l2=field,
        coarse_nodes=coarse.mesh.n_nodes,
        fine_nodes=fine.mesh.n_nodes,
    )


def check_convergence(
    case: Case,
    settings: MeshSettings | None = None,
    refine_factor: float = 1.6,
) -> ConvergenceReport:
    """Solve at ``settings`` and at a refined mesh and compare."""
    base = settings or MESH_PRESETS["reference"]
    return compare(solve(case, base), solve(case, base.refined(refine_factor)))


# ---------------------------------------------------------------------- convergence study
# Three-level study after Celik et al. (2008), "Procedure for estimation and reporting of
# uncertainty due to discretization in CFD applications", J. Fluids Eng. 130(7), 078001.
STUDY_PRESETS: tuple[str, ...] = ("fast", "reference", "fine")
GCI_SAFETY_FACTOR = 1.25
# Safety factor with the formal order when the observed order is unavailable (Roache, 1998).
GCI_SAFETY_FACTOR_FORMAL = 3.0
# Formal order of the recovered stress for P2 displacement elements in smooth regions.
FORMAL_ORDER = 2.0
MAX_STUDY_PROBES = 8
# Relative changes below this are round-off, where the observed order is undefined.
ROUND_OFF_REL = 1e-9


@dataclass(frozen=True)
class Richardson:
    """Richardson extrapolation and grid convergence index from three levels.

    ``kind``: ``monotonic`` (0 < R < L), ``oscillatory`` (-L < R < 0), ``divergent``
    (|R| >= L) or ``converged`` (no change between the two finest levels), with
    R = e21 / e32 and L = ln r21 / ln r32, which is 1 for a constant refinement ratio.
    ``order``: observed order p, solved by fixed-point iteration; ``None`` when undefined.
    ``order_used``: the order behind the extrapolation and GCI. For monotonic convergence it
    is min(p, :data:`FORMAL_ORDER`), so an observed order above the formal one does not
    shrink the band; otherwise it is the formal order.
    ``extrapolated``: (r21^q phi1 - phi2) / (r21^q - 1) with q = ``order_used``, reported
    only for monotonic convergence.
    ``error_fine``: relative change |phi1 - phi2| / |phi1| between the two finest levels.
    ``gci_fine``: Fs error_fine / (r21^q - 1), a relative band on the finest value, with
    Fs = 1.25 for monotonic convergence and 3 otherwise.
    """

    kind: str
    order: float | None
    order_used: float | None
    safety_factor: float
    extrapolated: float | None
    error_fine: float
    gci_fine: float
    ratio_fine: float
    ratio_coarse: float

    def to_dict(self) -> dict[str, float | str | None]:
        return {
            "kind": self.kind,
            "order": self.order,
            "order_used": self.order_used,
            "safety_factor": self.safety_factor,
            "extrapolated": self.extrapolated,
            "error_fine": self.error_fine,
            "gci_fine": self.gci_fine,
            "ratio_fine": self.ratio_fine,
            "ratio_coarse": self.ratio_coarse,
        }


def observed_order(
    e21: float, e32: float, r21: float, r32: float, iterations: int = 200, tol: float = 1e-12
) -> float | None:
    """Observed order p for non-constant refinement ratios, or ``None`` if undefined."""
    ratio = e32 / e21
    s = 1.0 if ratio > 0 else -1.0
    log_ratio = math.log(abs(ratio))
    p = abs(log_ratio) / math.log(r21)
    for _ in range(iterations):
        if p < 1e-9:
            return None
        num = r21**p - s
        den = r32**p - s
        if num <= 0 or den <= 0:
            return None
        nxt = abs(log_ratio + math.log(num / den)) / math.log(r21)
        if abs(nxt - p) <= tol * max(1.0, p):
            return nxt if nxt > 1e-9 else None
        p = nxt
    return None


def richardson(h: tuple[float, float, float], phi: tuple[float, float, float]) -> Richardson:
    """Extrapolate from (fine, medium, coarse) sizes ``h`` and values ``phi``."""
    h1, h2, h3 = h
    p1, p2, p3 = phi
    if not (0 < h1 < h2 < h3):
        raise ValueError("element sizes must be positive and ordered fine < medium < coarse")
    r21, r32 = h2 / h1, h3 / h2
    e21, e32 = p2 - p1, p3 - p2
    scale = max(abs(p1), abs(p2), abs(p3), 1e-300)
    error_fine = abs(e21) / max(abs(p1), 1e-300)
    small21 = abs(e21) <= ROUND_OFF_REL * scale
    small32 = abs(e32) <= ROUND_OFF_REL * scale
    if small21:
        # No change between the two finest levels: the finest value is its own limit.
        return Richardson("converged", None, None, GCI_SAFETY_FACTOR, p1, error_fine, 0.0, r21, r32)
    # For phi = phi0 + C h^p, R = (r21^p - 1) / (r21^p (r32^p - 1)), which falls from
    # ln r21 / ln r32 at p -> 0 to 0 as p grows; that limit replaces 1 for unequal ratios.
    limit = math.log(r21) / math.log(r32)
    if small32 or abs(e21 / e32) >= limit:
        kind = "divergent"
    else:
        kind = "monotonic" if e21 / e32 > 0 else "oscillatory"
    p = observed_order(e21, e32, r21, r32) if kind != "divergent" else None
    if kind == "monotonic" and p is not None:
        q = min(p, FORMAL_ORDER)
        rq = r21**q
        return Richardson(
            kind=kind,
            order=p,
            order_used=q,
            safety_factor=GCI_SAFETY_FACTOR,
            extrapolated=(rq * p1 - p2) / (rq - 1),
            error_fine=error_fine,
            gci_fine=GCI_SAFETY_FACTOR * error_fine / (rq - 1),
            ratio_fine=r21,
            ratio_coarse=r32,
        )
    rq = r21**FORMAL_ORDER
    return Richardson(
        kind=kind,
        order=p,
        order_used=FORMAL_ORDER,
        safety_factor=GCI_SAFETY_FACTOR_FORMAL,
        extrapolated=None,
        error_fine=error_fine,
        gci_fine=GCI_SAFETY_FACTOR_FORMAL * error_fine / (rq - 1),
        ratio_fine=r21,
        ratio_coarse=r32,
    )


def element_size(solution: Solution) -> float:
    """Representative element size sqrt(solid area / elements), in metres."""
    p = solution.mesh.points[solution.mesh.triangles]
    a = p[:, 1] - p[:, 0]
    b = p[:, 2] - p[:, 0]
    area = 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]).sum()
    return float(math.sqrt(area / solution.mesh.n_elements))


@dataclass(frozen=True)
class StudyLevel:
    preset: str
    nodes: int
    elements: int
    element_size: float
    hotspot: dict[str, float]
    probes: list[float]
    solve_ms: float
    # Change to the next finer level; ``None`` on the finest level.
    to_finer: ConvergenceReport | None
    passes: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "preset": self.preset,
            "nodes": self.nodes,
            "elements": self.elements,
            "element_size": self.element_size,
            "hotspot": self.hotspot,
            "probes": self.probes,
            "solve_ms": self.solve_ms,
            "to_finer": None if self.to_finer is None else self.to_finer.to_dict(),
            "passes": self.passes,
        }


@dataclass(frozen=True)
class ConvergenceStudy:
    """Levels ordered coarse to fine, with extrapolation of the hotspot and each probe.

    A level coarser than the finest passes when the change to the next finer level is within
    both tolerances (see :class:`ConvergenceReport`). The finest level passes when its
    hotspot GCI is within the hotspot tolerance. ``promoted`` is the finest passing level.
    """

    levels: list[StudyLevel]
    hotspot: Richardson
    probes: list[Richardson]
    probe_points: list[tuple[float, float]]

    @property
    def promoted(self) -> str | None:
        passing = [level.preset for level in self.levels if level.passes]
        return passing[-1] if passing else None

    def to_dict(self) -> dict[str, object]:
        return {
            "levels": [level.to_dict() for level in self.levels],
            "hotspot": self.hotspot.to_dict(),
            "probes": [
                {"x": x, "y": y, **r.to_dict()}
                for (x, y), r in zip(self.probe_points, self.probes, strict=True)
            ],
            "promoted": self.promoted,
            "hotspot_tolerance": HOTSPOT_TOLERANCE,
            "field_tolerance": FIELD_TOLERANCE,
            "gci_safety_factor": GCI_SAFETY_FACTOR,
        }


def _probe_values(solution: Solution, points: list[tuple[float, float]]) -> list[float]:
    if not points:
        return []
    px = np.array([p[0] for p in points], dtype=float)
    py = np.array([p[1] for p in points], dtype=float)
    s = solution.stress.sample(px, py)
    return [float(v) for v in von_mises(s[:, 0], s[:, 1], s[:, 2])]


def check_probes(case: Case, points: list[tuple[float, float]]) -> None:
    """Probes must be finite, inside the solid and at most :data:`MAX_STUDY_PROBES`."""
    if len(points) > MAX_STUDY_PROBES:
        raise ValueError(f"at most {MAX_STUDY_PROBES} probes")
    if not points:
        return
    px = np.array([p[0] for p in points], dtype=float)
    py = np.array([p[1] for p in points], dtype=float)
    if not np.all(np.isfinite(px) & np.isfinite(py)):
        raise ValueError("probe coordinates must be finite")
    inside = signed_distance(case, px, py) < 0
    if not inside.all():
        k = int(np.argmin(inside))
        raise ValueError(f"probe {k + 1} is outside the solid")


def convergence_study(
    case: Case,
    presets: tuple[str, ...] = STUDY_PRESETS,
    probes: list[tuple[float, float]] | None = None,
) -> ConvergenceStudy:
    """Solve at three mesh presets, compare neighbours and extrapolate the hotspot."""
    if len(presets) != 3 or len(set(presets)) != 3:
        raise ValueError("a convergence study takes three different mesh presets")
    unknown = [p for p in presets if p not in MESH_PRESETS]
    if unknown:
        raise ValueError(f"unknown mesh preset {unknown[0]!r}")
    points = list(probes or [])
    check_probes(case, points)
    solved = []
    for name in presets:
        t0 = time.perf_counter()
        sol = solve(case, MESH_PRESETS[name])
        solved.append((name, sol, element_size(sol), 1e3 * (time.perf_counter() - t0)))
    solved.sort(key=lambda item: -item[2])  # coarse to fine
    sizes = [item[2] for item in solved]
    if not (sizes[0] > sizes[1] > sizes[2]):
        raise ValueError("the presets must give three distinct element sizes")
    hot = [item[1].hotspot() for item in solved]
    values = [_probe_values(item[1], points) for item in solved]
    fine_first = (sizes[2], sizes[1], sizes[0])
    hotspot = richardson(
        fine_first, (hot[2]["von_mises"], hot[1]["von_mises"], hot[0]["von_mises"])
    )
    probe_fits = [
        richardson(fine_first, (values[2][k], values[1][k], values[0][k]))
        for k in range(len(points))
    ]
    reports = [compare(solved[i][1], solved[i + 1][1]) for i in range(2)]
    passes = [reports[0].converged, reports[1].converged, hotspot.gci_fine <= HOTSPOT_TOLERANCE]
    levels = [
        StudyLevel(
            preset=name,
            nodes=sol.mesh.n_nodes,
            elements=sol.mesh.n_elements,
            element_size=size,
            hotspot={k: float(v) for k, v in hot[i].items()},
            probes=values[i],
            solve_ms=ms,
            to_finer=reports[i] if i < 2 else None,
            passes=passes[i],
        )
        for i, (name, sol, size, ms) in enumerate(solved)
    ]
    return ConvergenceStudy(levels, hotspot, probe_fits, points)
