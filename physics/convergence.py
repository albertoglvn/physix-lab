"""Mesh convergence checks with explicit metrics and tolerances.

Metrics compare a solve against a refined solve of the identical case:

* ``hotspot_rel``: relative change of the hotspot von Mises stress (see
  :data:`physics.solver.HOTSPOT_EXCLUSION_REL`).
* ``field_rel_l2``: relative L2 change of von Mises stress sampled on a regular probe grid
  inside the solid, excluding a band of 0.02 x width next to every boundary (where the
  polygonal boundary approximation differs between meshes).

A solve qualifies as a reference when both metrics are within tolerance.
"""

from __future__ import annotations

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
