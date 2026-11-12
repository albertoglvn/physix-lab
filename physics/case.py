"""Versioned case schema for 2D plane-stress plates and brackets.

Conventions (shared with ``docs/CONTRACTS.md``):

* SI units everywhere: metres, pascals, newtons.
* Origin at the lower-left corner of the part's bounding box, ``x`` to the right and
  ``y`` upwards.
* ``plate``: rectangle ``[0, width] x [0, height]``. The left edge ``x = 0`` is supported
  and the load acts on the right edge ``x = width``.
* ``bracket``: L-shape made of a vertical web ``[0, web_width] x [0, height]`` and a
  horizontal flange ``[0, width] x [0, flange_height]`` joined by a concave fillet. The top
  edge of the web ``y = height`` is supported and the load acts on the flange tip
  ``x = width, 0 <= y <= flange_height``.
* Loads are either a uniform ``traction`` (Pa) on the load edge or a resultant ``force``
  (N). A force is converted to traction with ``t = F / (edge_length * thickness)``.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

CASE_SCHEMA = "physix.case/1"

Family = Literal["plate", "bracket"]
Support = Literal["clamped", "roller"]

SUPPORTED_ANALYSIS = {
    "type": "linear_static",
    "dimension": 2,
    "formulation": "plane_stress",
    "material_model": "linear_elastic_isotropic",
}

# Requests that are recognised but outside the v1 scope, with a reason for each.
OUT_OF_SCOPE = {
    "dimension": "Only 2D plane-stress analysis is supported; 3D solids are out of scope.",
    "type": (
        "Only small-strain linear static analysis is supported; dynamics, buckling, modal, "
        "contact, fracture and large deformation are out of scope."
    ),
    "formulation": "Only plane stress is supported; plane strain and shell bending are not.",
    "material_model": (
        "Only isotropic linear elasticity is supported; plasticity and nonlinear materials "
        "are out of scope."
    ),
}

MAX_HOLES = 6


class CaseValidationError(ValueError):
    """The case is malformed or violates a geometric or physical limit."""

    def __init__(self, message: str, field_path: str | None = None) -> None:
        super().__init__(message)
        self.field_path = field_path

    def to_dict(self) -> dict[str, Any]:
        return {"error": "invalid_case", "message": str(self), "field": self.field_path}


class UnsupportedCaseError(CaseValidationError):
    """The request is well formed but asks for physics outside the v1 scope."""

    def to_dict(self) -> dict[str, Any]:
        return {"error": "unsupported_case", "message": str(self), "field": self.field_path}


@dataclass(frozen=True)
class Hole:
    x: float
    y: float
    radius: float


@dataclass(frozen=True)
class Geometry:
    width: float
    height: float
    holes: tuple[Hole, ...] = ()
    # Bracket-only parameters; ``None`` for plates.
    web_width: float | None = None
    flange_height: float | None = None
    fillet_radius: float | None = None


@dataclass(frozen=True)
class Material:
    young: float
    poisson: float
    name: str = "custom"


@dataclass(frozen=True)
class Load:
    """A uniform traction (Pa) or a resultant force (N) on the load edge."""

    kind: Literal["traction", "force"]
    x: float
    y: float


@dataclass(frozen=True)
class Case:
    family: Family
    geometry: Geometry
    thickness: float
    material: Material
    load: Load
    support: Support = "clamped"
    schema: str = CASE_SCHEMA
    meta: dict[str, Any] = field(default_factory=dict, compare=False, hash=False)

    # ----------------------------------------------------------------- derived values
    @property
    def load_edge_length(self) -> float:
        g = self.geometry
        if self.family == "plate":
            return g.height
        assert g.flange_height is not None
        return g.flange_height

    @property
    def support_edge_length(self) -> float:
        g = self.geometry
        if self.family == "plate":
            return g.height
        assert g.web_width is not None
        return g.web_width

    def traction(self) -> tuple[float, float]:
        """Return the equivalent uniform traction in Pa on the load edge."""
        if self.load.kind == "traction":
            return (self.load.x, self.load.y)
        area = self.load_edge_length * self.thickness
        return (self.load.x / area, self.load.y / area)

    def resultant_force(self) -> tuple[float, float]:
        """Return the applied resultant force in N."""
        tx, ty = self.traction()
        area = self.load_edge_length * self.thickness
        return (tx * area, ty * area)

    def traction_magnitude(self) -> float:
        tx, ty = self.traction()
        return math.hypot(tx, ty)

    # ------------------------------------------------------------------- serialization
    def to_dict(self) -> dict[str, Any]:
        g = self.geometry
        geometry: dict[str, Any] = {
            "width": g.width,
            "height": g.height,
            "holes": [asdict(h) for h in g.holes],
        }
        if self.family == "bracket":
            geometry["web_width"] = g.web_width
            geometry["flange_height"] = g.flange_height
            geometry["fillet_radius"] = g.fillet_radius
        out: dict[str, Any] = {
            "schema": self.schema,
            "family": self.family,
            "geometry": geometry,
            "thickness": self.thickness,
            "material": {
                "name": self.material.name,
                "young": self.material.young,
                "poisson": self.material.poisson,
            },
            "support": self.support,
            "load": {"kind": self.load.kind, "x": self.load.x, "y": self.load.y},
        }
        if self.meta:
            out["meta"] = dict(self.meta)
        return out

    def case_id(self) -> str:
        """Stable identity of the physical case (metadata excluded)."""
        payload = self.to_dict()
        payload.pop("meta", None)
        payload["material"].pop("name", None)
        canonical = json.dumps(_round_floats(payload), sort_keys=True, separators=(",", ":"))
        return "case_" + hashlib.sha256(canonical.encode()).hexdigest()[:16]

    def scaled_load(self, factor: float) -> Case:
        return Case(
            family=self.family,
            geometry=self.geometry,
            thickness=self.thickness,
            material=self.material,
            load=Load(self.load.kind, self.load.x * factor, self.load.y * factor),
            support=self.support,
            meta=dict(self.meta),
        )


def _round_floats(value: Any) -> Any:
    if isinstance(value, float):
        return float(f"{value:.12g}")
    if isinstance(value, dict):
        return {k: _round_floats(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_round_floats(v) for v in value]
    return value


# ------------------------------------------------------------------------- parsing
def _number(data: dict[str, Any], key: str, path: str, *, required: bool = True) -> float:
    if key not in data or data[key] is None:
        if required:
            raise CaseValidationError(f"Missing required field '{path}{key}'.", path + key)
        return math.nan
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise CaseValidationError(f"Field '{path}{key}' must be a number.", path + key)
    value = float(value)
    if not math.isfinite(value):
        raise CaseValidationError(f"Field '{path}{key}' must be finite.", path + key)
    return value


def _check_analysis(data: dict[str, Any]) -> None:
    analysis = data.get("analysis")
    if analysis is None:
        return
    if not isinstance(analysis, dict):
        raise CaseValidationError("Field 'analysis' must be an object.", "analysis")
    for key, value in analysis.items():
        if key not in SUPPORTED_ANALYSIS:
            raise UnsupportedCaseError(f"Unknown analysis option '{key}'.", f"analysis.{key}")
        if value != SUPPORTED_ANALYSIS[key]:
            raise UnsupportedCaseError(OUT_OF_SCOPE[key], f"analysis.{key}")


def case_from_dict(data: Any) -> Case:
    """Parse and fully validate a case from JSON-compatible data."""
    if not isinstance(data, dict):
        raise CaseValidationError("A case must be a JSON object.")
    schema = data.get("schema", CASE_SCHEMA)
    if schema != CASE_SCHEMA:
        raise CaseValidationError(
            f"Unsupported case schema '{schema}'; expected '{CASE_SCHEMA}'.", "schema"
        )
    _check_analysis(data)

    family = data.get("family")
    if family not in ("plate", "bracket"):
        raise CaseValidationError("Field 'family' must be 'plate' or 'bracket'.", "family")

    geo = data.get("geometry")
    if not isinstance(geo, dict):
        raise CaseValidationError("Missing object 'geometry'.", "geometry")
    raw_holes = geo.get("holes", [])
    if not isinstance(raw_holes, list):
        raise CaseValidationError("Field 'geometry.holes' must be a list.", "geometry.holes")
    if len(raw_holes) > MAX_HOLES:
        raise CaseValidationError(f"At most {MAX_HOLES} holes are supported.", "geometry.holes")
    holes = []
    for i, raw in enumerate(raw_holes):
        if not isinstance(raw, dict):
            raise CaseValidationError("Each hole must be an object.", f"geometry.holes[{i}]")
        p = f"geometry.holes[{i}]."
        holes.append(Hole(_number(raw, "x", p), _number(raw, "y", p), _number(raw, "radius", p)))

    is_bracket = family == "bracket"
    geometry = Geometry(
        width=_number(geo, "width", "geometry."),
        height=_number(geo, "height", "geometry."),
        holes=tuple(holes),
        web_width=_number(geo, "web_width", "geometry.") if is_bracket else None,
        flange_height=_number(geo, "flange_height", "geometry.") if is_bracket else None,
        fillet_radius=_number(geo, "fillet_radius", "geometry.") if is_bracket else None,
    )

    mat = data.get("material")
    if not isinstance(mat, dict):
        raise CaseValidationError("Missing object 'material'.", "material")
    material = Material(
        young=_number(mat, "young", "material."),
        poisson=_number(mat, "poisson", "material."),
        name=str(mat.get("name", "custom")),
    )

    load_raw = data.get("load")
    if not isinstance(load_raw, dict):
        raise CaseValidationError("Missing object 'load'.", "load")
    kind = load_raw.get("kind", "traction")
    if kind not in ("traction", "force"):
        raise CaseValidationError("Field 'load.kind' must be 'traction' or 'force'.", "load.kind")
    load = Load(kind=kind, x=_number(load_raw, "x", "load."), y=_number(load_raw, "y", "load."))

    support = data.get("support", "clamped")
    if support not in ("clamped", "roller"):
        raise CaseValidationError("Field 'support' must be 'clamped' or 'roller'.", "support")
    if support == "roller" and is_bracket:
        raise CaseValidationError("Roller support is only defined for plates.", "support")

    meta = data.get("meta") or {}
    if not isinstance(meta, dict):
        raise CaseValidationError("Field 'meta' must be an object.", "meta")

    case = Case(
        family=family,
        geometry=geometry,
        thickness=_number(data, "thickness", ""),
        material=material,
        load=load,
        support=support,
        meta=meta,
    )
    validate_case(case)
    return case


# ---------------------------------------------------------------------- validation
def validate_case(case: Case) -> None:
    """Raise :class:`CaseValidationError` if the case is outside the solver's limits."""
    # Imported lazily to keep the schema module light.
    from physics.geometry import validate_geometry

    g = case.geometry
    if not 1e-3 <= g.width <= 10.0:
        raise CaseValidationError("geometry.width must lie in [0.001, 10] m.", "geometry.width")
    if not 0.05 * g.width <= g.height <= 2.0 * g.width:
        raise CaseValidationError(
            "geometry.height must lie in [0.05, 2.0] x width.", "geometry.height"
        )
    if not case.thickness > 0:
        raise CaseValidationError("thickness must be positive.", "thickness")
    if case.thickness > 0.25 * min(g.width, g.height):
        raise UnsupportedCaseError(
            "thickness exceeds 0.25 x the smallest in-plane dimension; the plane-stress "
            "assumption no longer holds and a 3D analysis would be required.",
            "thickness",
        )
    m = case.material
    if not 1e6 <= m.young <= 2e12:
        raise CaseValidationError("material.young must lie in [1e6, 2e12] Pa.", "material.young")
    if not 0.0 <= m.poisson < 0.5:
        raise CaseValidationError("material.poisson must lie in [0, 0.5).", "material.poisson")
    if case.traction_magnitude() == 0:
        raise CaseValidationError("The load must be non-zero.", "load")
    if case.traction_magnitude() > 1e11:
        raise CaseValidationError("Traction magnitude must not exceed 1e11 Pa.", "load")
    validate_geometry(case)
