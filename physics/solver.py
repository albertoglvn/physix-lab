"""scikit-fem reference solver for plane-stress linear elasticity.

The solver factorises the stiffness matrix once and solves two unit load cases: a unit
traction in ``x`` and a unit traction in ``y`` on the load edge. Any uniform traction is a
linear combination of these, which is exact for linear elasticity. The physical case is
recovered with :meth:`UnitSolution.combine`.

Stress is recovered exactly at the vertices of each element (for P2 displacements the
stress is linear on each straight-sided triangle), giving a discontinuous piecewise-linear
field. Nodal values for display are area-weighted averages of these element values.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import skfem
from scipy.sparse.linalg import splu
from scipy.spatial import cKDTree
from skfem import Basis, ElementTriP1, ElementTriP2, ElementVector, FacetBasis, LinearForm, asm
from skfem.models.elasticity import lame_parameters, linear_elasticity

from physics.case import Case
from physics.geometry import distance_to_segment, support_segment
from physics.mesh import MESH_PRESETS, MeshSettings, TaggedMesh, build_mesh

SOLVER_NAME = "scikit-fem"
SOLVER_VERSION = skfem.__version__
COMPONENTS = ("sxx", "syy", "txy")
# Hotspot metric: maximum von Mises stress outside a band next to the support edge, whose
# corners carry a mesh-dependent stress singularity. Width relative to the part width.
HOTSPOT_EXCLUSION_REL = 0.05


class SolverError(RuntimeError):
    """The reference solve failed."""


def von_mises(sxx: np.ndarray, syy: np.ndarray, txy: np.ndarray) -> np.ndarray:
    """Plane-stress von Mises equivalent stress (szz = 0)."""
    return np.sqrt(np.maximum(sxx * sxx - sxx * syy + syy * syy + 3.0 * txy * txy, 0.0))


@dataclass
class ElementField:
    """Discontinuous piecewise-linear field stored at element vertices.

    ``values`` has shape (n_elements, 3, n_channels).
    """

    points: np.ndarray
    triangles: np.ndarray
    values: np.ndarray
    _tree: cKDTree | None = field(default=None, init=False, repr=False)

    def nodal_average(self) -> np.ndarray:
        """Area-weighted nodal average, shape (n_nodes, n_channels)."""
        p = self.points[self.triangles]
        area = 0.5 * np.abs(
            (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1])
            - (p[:, 2, 0] - p[:, 0, 0]) * (p[:, 1, 1] - p[:, 0, 1])
        )
        n, c = len(self.points), self.values.shape[2]
        acc = np.zeros((n, c))
        wsum = np.zeros(n)
        for k in range(3):
            np.add.at(acc, self.triangles[:, k], self.values[:, k, :] * area[:, None])
            np.add.at(wsum, self.triangles[:, k], area)
        return acc / wsum[:, None]

    def sample(self, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        """Evaluate at points; points outside the mesh use the nearest element."""
        px = np.asarray(px, dtype=float).ravel()
        py = np.asarray(py, dtype=float).ravel()
        tri = self.triangles
        p = self.points[tri]
        if self._tree is None:
            self._tree = cKDTree(p.mean(axis=1))
        k = min(12, len(tri))
        _, cand = self._tree.query(np.column_stack([px, py]), k=k)
        cand = cand.reshape(len(px), k)
        a = p[cand, 0]
        b = p[cand, 1]
        c = p[cand, 2]
        det = (b[..., 0] - a[..., 0]) * (c[..., 1] - a[..., 1]) - (c[..., 0] - a[..., 0]) * (
            b[..., 1] - a[..., 1]
        )
        l1 = (
            (px[:, None] - a[..., 0]) * (c[..., 1] - a[..., 1])
            - (c[..., 0] - a[..., 0]) * (py[:, None] - a[..., 1])
        ) / det
        l2 = (
            (b[..., 0] - a[..., 0]) * (py[:, None] - a[..., 1])
            - (px[:, None] - a[..., 0]) * (b[..., 1] - a[..., 1])
        ) / det
        l0 = 1.0 - l1 - l2
        bary = np.stack([l0, l1, l2], axis=-1)
        inside = np.all(bary >= -1e-9, axis=-1)
        first = np.where(inside.any(axis=1), inside.argmax(axis=1), 0)
        rows = np.arange(len(px))
        elem = cand[rows, first]
        w = bary[rows, first]
        w = np.clip(w, 0.0, None)
        w /= w.sum(axis=1, keepdims=True)
        return np.einsum("nk,nkc->nc", w, self.values[elem])


@dataclass
class Timing:
    mesh_ms: float = 0.0
    assemble_ms: float = 0.0
    solve_ms: float = 0.0
    recover_ms: float = 0.0

    @property
    def total_ms(self) -> float:
        return self.mesh_ms + self.assemble_ms + self.solve_ms + self.recover_ms

    def to_dict(self) -> dict[str, float]:
        return {
            "mesh_ms": round(self.mesh_ms, 3),
            "assemble_ms": round(self.assemble_ms, 3),
            "solve_ms": round(self.solve_ms, 3),
            "recover_ms": round(self.recover_ms, 3),
            "total_ms": round(self.total_ms, 3),
        }


@dataclass
class UnitSolution:
    """Fields for unit tractions (1 Pa) in x and y on the load edge.

    ``stress``: ElementField with 6 channels ordered
    ``(sxx_x, syy_x, txy_x, sxx_y, syy_y, txy_y)`` in Pa per Pa of traction.
    ``displacement``: (n_nodes, 4) vertex displacements ``(ux_x, uy_x, ux_y, uy_y)`` in
    metres per Pa of traction.
    ``reactions``: (2, 2) support reaction resultants in N per Pa, rows = unit load.
    """

    case: Case
    mesh: TaggedMesh
    settings: MeshSettings
    stress: ElementField
    displacement: np.ndarray
    reactions: np.ndarray
    timing: Timing

    def combine(self) -> Solution:
        tx, ty = self.case.traction()
        v = self.stress.values
        s = tx * v[..., 0:3] + ty * v[..., 3:6]
        d = self.displacement
        u = np.column_stack([tx * d[:, 0] + ty * d[:, 2], tx * d[:, 1] + ty * d[:, 3]])
        reaction = tx * self.reactions[0] + ty * self.reactions[1]
        return Solution(
            case=self.case,
            mesh=self.mesh,
            settings=self.settings,
            stress=ElementField(self.mesh.points, self.mesh.triangles, s),
            displacement=u,
            reaction=reaction,
            timing=self.timing,
        )


@dataclass
class Solution:
    """Physical solution for the case's load. Stress in Pa, displacement in m."""

    case: Case
    mesh: TaggedMesh
    settings: MeshSettings
    stress: ElementField
    displacement: np.ndarray
    reaction: np.ndarray
    timing: Timing

    def von_mises_elements(self) -> np.ndarray:
        v = self.stress.values
        return von_mises(v[..., 0], v[..., 1], v[..., 2])

    def hotspot(self) -> dict[str, float]:
        """Maximum von Mises stress outside the support exclusion band."""
        vm = self.von_mises_elements()
        p = self.mesh.points[self.mesh.triangles]
        seg = support_segment(self.case)
        d = distance_to_segment(seg, p[..., 0], p[..., 1])
        band = HOTSPOT_EXCLUSION_REL * self.case.geometry.width
        masked = np.where(d >= band, vm, -np.inf)
        if not np.isfinite(masked).any():
            masked = vm
        e, k = np.unravel_index(int(np.argmax(masked)), masked.shape)
        value = float(vm[e, k])
        nominal = self.case.traction_magnitude()
        return {
            "von_mises": value,
            "x": float(p[e, k, 0]),
            "y": float(p[e, k, 1]),
            "stress_concentration": value / nominal,
            "exclusion_band": band,
        }

    def summary(self) -> dict[str, object]:
        vm = self.von_mises_elements()
        fx, fy = self.case.resultant_force()
        umag = np.hypot(self.displacement[:, 0], self.displacement[:, 1])
        return {
            "max_von_mises": float(vm.max()),
            "hotspot": self.hotspot(),
            "max_displacement": float(umag.max()),
            "applied_force": [fx, fy],
            "reaction_force": [float(self.reaction[0]), float(self.reaction[1])],
            "equilibrium_residual": float(
                np.hypot(fx + self.reaction[0], fy + self.reaction[1])
                / max(np.hypot(fx, fy), 1e-30)
            ),
        }


# ---------------------------------------------------------------------------- solve
def _facet_indices(mesh: skfem.MeshTri, edges: np.ndarray) -> np.ndarray:
    n = mesh.p.shape[1]
    facets = np.sort(mesh.facets, axis=0)
    keys = facets[0] * n + facets[1]
    order = np.argsort(keys)
    e = np.sort(edges, axis=1)
    q = e[:, 0] * n + e[:, 1]
    pos = np.searchsorted(keys[order], q)
    idx = order[pos]
    if not np.array_equal(keys[idx], q):
        raise SolverError("Tagged boundary edge missing from the finite-element mesh.")
    return idx


def solve_unit(case: Case, settings: MeshSettings | str | None = None) -> UnitSolution:
    """Mesh and solve the two unit load cases for ``case``."""
    if isinstance(settings, str):
        settings = MESH_PRESETS[settings]
    settings = settings or MESH_PRESETS["reference"]
    timing = Timing()

    t0 = time.perf_counter()
    tagged = build_mesh(case, settings)
    timing.mesh_ms = (time.perf_counter() - t0) * 1e3

    t0 = time.perf_counter()
    mesh = skfem.MeshTri(tagged.points.T.copy(), tagged.triangles.T.copy())
    elem = ElementTriP2() if settings.element_order == 2 else ElementTriP1()
    e = ElementVector(elem)
    basis = Basis(mesh, e, intorder=2 * settings.element_order)
    young, nu = case.material.young, case.material.poisson
    lam, mu = lame_parameters(young, nu)
    lam_ps = 2.0 * lam * mu / (lam + 2.0 * mu)  # plane-stress first Lamé parameter
    stiffness = asm(linear_elasticity(lam_ps, mu), basis)

    load_facets = _facet_indices(mesh, tagged.boundary_edges["load"])
    fbasis = FacetBasis(mesh, e, facets=load_facets, intorder=2 * settings.element_order)

    @LinearForm
    def unit_x(v, w):
        return v[0]

    @LinearForm
    def unit_y(v, w):
        return v[1]

    rhs = np.column_stack([asm(unit_x, fbasis), asm(unit_y, fbasis)])

    support_facets = _facet_indices(mesh, tagged.boundary_edges["support"])
    sup_dofs = basis.get_dofs(support_facets)
    if case.support == "clamped":
        fixed = sup_dofs.all()
    else:
        # Roller: normal displacement fixed along the support edge; one node pinned in y.
        fixed_x = sup_dofs.all("u^1")
        nodes = np.unique(tagged.boundary_edges["support"])
        pin = nodes[np.argmin(mesh.p[1, nodes])]
        pin_y = basis.get_dofs(nodes=np.array([pin])).all("u^2")
        fixed = np.unique(np.concatenate([fixed_x, pin_y]))
    free = np.setdiff1d(np.arange(basis.N), fixed)
    timing.assemble_ms = (time.perf_counter() - t0) * 1e3

    t0 = time.perf_counter()
    try:
        lu = splu(stiffness[free][:, free].tocsc())
        u_free = lu.solve(rhs[free])
    except RuntimeError as exc:  # singular matrix
        raise SolverError(f"Linear solve failed: {exc}") from exc
    if not np.all(np.isfinite(u_free)):
        raise SolverError("Linear solve produced non-finite displacements.")
    u = np.zeros((basis.N, 2))
    u[free] = u_free
    timing.solve_ms = (time.perf_counter() - t0) * 1e3

    t0 = time.perf_counter()
    # Reactions per unit traction, scaled by thickness to newtons.
    residual = stiffness @ u - rhs
    reactions = np.zeros((2, 2))
    nodal = basis.get_dofs(support_facets)
    rx = np.concatenate([nodal.all("u^1")])
    ry = np.concatenate([nodal.all("u^2")])
    if case.support == "roller":
        ry = pin_y
    for k in range(2):
        reactions[k, 0] = residual[rx, k].sum() * case.thickness
        reactions[k, 1] = residual[ry, k].sum() * case.thickness

    # Exact stress at element vertices: quadrature points at the reference vertices.
    vertex_quad = (np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]), np.full(3, 1.0 / 6.0))
    vbasis = Basis(mesh, e, quadrature=vertex_quad)
    coef = young / (1.0 - nu * nu)
    channels = []
    for k in range(2):
        grad = vbasis.interpolate(u[:, k]).grad  # (2, 2, n_elements, 3)
        exx, eyy = grad[0, 0], grad[1, 1]
        gxy = grad[0, 1] + grad[1, 0]
        channels += [coef * (exx + nu * eyy), coef * (eyy + nu * exx), mu * gxy]
    values = np.stack(channels, axis=-1)  # local vertex order of ``mesh.t``
    # scikit-fem sorts the vertex indices of each element (``sort_t``), so map the values
    # back to the counter-clockwise vertex order of ``tagged.triangles``.
    skfem_t = mesh.t.T
    local = np.argmax(skfem_t[:, None, :] == tagged.triangles[:, :, None], axis=2)
    values = np.take_along_axis(values, local[:, :, None], axis=1)
    stress = ElementField(tagged.points, tagged.triangles, values)

    vdofs = basis.nodal_dofs  # (2, n_nodes) for vertex dofs
    displacement = np.column_stack([u[vdofs[0], 0], u[vdofs[1], 0], u[vdofs[0], 1], u[vdofs[1], 1]])
    timing.recover_ms = (time.perf_counter() - t0) * 1e3

    return UnitSolution(
        case=case,
        mesh=tagged,
        settings=settings,
        stress=stress,
        displacement=displacement,
        reactions=reactions,
        timing=timing,
    )


def solve(case: Case, settings: MeshSettings | str | None = None) -> Solution:
    """Solve the physical case with its own load."""
    return solve_unit(case, settings).combine()
