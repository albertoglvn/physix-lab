"""Physix physics: case schema, geometry, meshing and the scikit-fem reference solver."""

from physics.case import (
    CASE_SCHEMA,
    Case,
    CaseValidationError,
    Geometry,
    Hole,
    Load,
    Material,
    UnsupportedCaseError,
    case_from_dict,
    validate_case,
)
from physics.mesh import MESH_PRESETS, MeshError, MeshSettings, build_mesh
from physics.solver import (
    SOLVER_NAME,
    SOLVER_VERSION,
    Solution,
    SolverError,
    UnitSolution,
    solve,
    solve_unit,
    von_mises,
)

__all__ = [
    "CASE_SCHEMA",
    "MESH_PRESETS",
    "SOLVER_NAME",
    "SOLVER_VERSION",
    "Case",
    "CaseValidationError",
    "Geometry",
    "Hole",
    "Load",
    "Material",
    "MeshError",
    "MeshSettings",
    "Solution",
    "SolverError",
    "UnitSolution",
    "UnsupportedCaseError",
    "build_mesh",
    "case_from_dict",
    "solve",
    "solve_unit",
    "validate_case",
    "von_mises",
]
