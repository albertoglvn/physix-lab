"""Surrogate training domain, deterministic case sampling and the domain check.

All geometric bounds are relative to the part width because the stress per unit traction
is invariant to uniform scaling. The domain is narrower than what the solver accepts; a
solver-valid case outside it is routed to FEM rather than to the surrogate.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from data.raster import fits_frame
from physics.case import Case, CaseValidationError, case_from_dict
from physics.geometry import distance_to_outer_boundary, outer_sdf
from physics.materials import MATERIALS

DOMAIN_VERSION = "physix.domain/1"

DOMAIN: dict[str, Any] = {
    "version": DOMAIN_VERSION,
    "support": ["clamped"],
    "poisson": [0.25, 0.40],
    "hole_clearance_rel": 0.03,
    "plate": {
        "aspect": [0.25, 0.5],
        "holes": [0, 3],
        "hole_radius_rel": [0.025, 0.10],
    },
    "bracket": {
        "aspect": [0.35, 0.5],
        "web_width_rel": [0.12, 0.30],
        "flange_height_rel_height": [0.25, 0.60],
        "fillet_radius_rel": [0.01, 0.05],
        "holes": [0, 2],
        "hole_radius_rel": [0.02, 0.05],
    },
}

# Probability of each hole count per family.
HOLE_COUNT_WEIGHTS = {"plate": [0.05, 0.5, 0.3, 0.15], "bracket": [0.25, 0.5, 0.25]}
_EPS = 1e-9


@dataclass(frozen=True)
class DomainCheck:
    in_domain: bool
    reasons: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {"in_domain": self.in_domain, "reasons": list(self.reasons)}


def _within(value: float, bounds: list[float]) -> bool:
    return bounds[0] - _EPS <= value <= bounds[1] + _EPS


def check_domain(case: Case, domain: dict[str, Any] | None = None) -> DomainCheck:
    """Explain whether ``case`` lies inside the surrogate's training domain."""
    d = domain or DOMAIN
    reasons: list[str] = []
    g = case.geometry
    w = g.width
    fam = d.get(case.family)
    if fam is None:
        return DomainCheck(False, (f"family '{case.family}' is not in the training domain",))
    if case.support not in d["support"]:
        reasons.append(f"support '{case.support}' is not in the training domain")
    if not _within(case.material.poisson, d["poisson"]):
        reasons.append(f"poisson {case.material.poisson:.3g} outside {d['poisson']}")
    if not fits_frame(case):
        reasons.append("height exceeds the raster frame (0.5 x width)")
    aspect = g.height / w
    if not _within(aspect, fam["aspect"]):
        reasons.append(f"height/width {aspect:.3g} outside {fam['aspect']}")
    n = len(g.holes)
    if not fam["holes"][0] <= n <= fam["holes"][1]:
        reasons.append(f"{n} holes outside the trained range {fam['holes']}")
    for i, hole in enumerate(g.holes):
        r = hole.radius / w
        if not _within(r, fam["hole_radius_rel"]):
            reasons.append(f"hole {i} radius/width {r:.3g} outside {fam['hole_radius_rel']}")
        lig = distance_to_outer_boundary(case, np.array([hole.x]), np.array([hole.y]))[0]
        if (lig - hole.radius) / w < d["hole_clearance_rel"] - _EPS:
            reasons.append(f"hole {i} is closer to the outline than the trained clearance")
        for j, other in enumerate(g.holes[:i]):
            gap = math.hypot(hole.x - other.x, hole.y - other.y) - hole.radius - other.radius
            if gap / w < d["hole_clearance_rel"] - _EPS:
                reasons.append(f"holes {j} and {i} are closer than the trained clearance")
    if case.family == "bracket":
        assert g.web_width is not None and g.flange_height is not None
        if not _within(g.web_width / w, fam["web_width_rel"]):
            reasons.append("web_width outside the trained range")
        if not _within(g.flange_height / g.height, fam["flange_height_rel_height"]):
            reasons.append("flange_height outside the trained range")
        if not _within((g.fillet_radius or 0.0) / w, fam["fillet_radius_rel"]):
            reasons.append("fillet_radius outside the trained range")
    return DomainCheck(not reasons, tuple(reasons))


# ------------------------------------------------------------------------ sampling
def _material(rng: np.random.Generator, poisson_bounds: list[float]) -> dict[str, Any]:
    name = str(rng.choice(sorted(MATERIALS)))
    nu = float(rng.uniform(*poisson_bounds))
    return {"name": name, "young": MATERIALS[name].young, "poisson": round(nu, 4)}


def _load(rng: np.random.Generator) -> dict[str, Any]:
    """Traction of 1 MPa: half pure x, a quarter pure y, a quarter in a random direction."""
    u = rng.random()
    theta = (
        0.0 if u < 0.5 else (-0.5 * math.pi if u < 0.75 else float(rng.uniform(-math.pi, math.pi)))
    )
    return {
        "kind": "traction",
        "x": round(1e6 * math.cos(theta), 3),
        "y": round(1e6 * math.sin(theta), 3),
    }


def _place_holes(
    rng: np.random.Generator,
    base: dict[str, Any],
    n: int,
    radius_rel: list[float],
    clearance_rel: float,
    tries: int = 200,
) -> list[dict[str, float]] | None:
    """Rejection-sample ``n`` holes that satisfy the domain clearance."""
    geo = base["geometry"]
    w, h = geo["width"], geo["height"]
    holes: list[dict[str, float]] = []
    probe = case_from_dict({**base, "geometry": {**geo, "holes": []}})
    for _ in range(n):
        for _ in range(tries):
            r = float(rng.uniform(*radius_rel)) * w
            x = float(rng.uniform(0, w))
            y = float(rng.uniform(0, h))
            lig = distance_to_outer_boundary(probe, np.array([x]), np.array([y]))[0]
            if outer_sdf(probe, np.array([x]), np.array([y]))[0] >= 0:
                continue
            if lig - r < (clearance_rel + 0.002) * w:
                continue
            if any(
                math.hypot(x - o["x"], y - o["y"]) - r - o["radius"] < (clearance_rel + 0.002) * w
                for o in holes
            ):
                continue
            holes.append({"x": x, "y": y, "radius": r})
            break
        else:
            return None
    return holes


def sample_base(
    rng: np.random.Generator, family: str, domain: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Sample one valid base design dictionary, or ``None`` if placement failed."""
    d = domain or DOMAIN
    fam = d[family]
    width = float(rng.uniform(0.05, 0.5))
    height = float(rng.uniform(*fam["aspect"])) * width
    geometry: dict[str, Any] = {"width": width, "height": height, "holes": []}
    if family == "bracket":
        geometry["web_width"] = float(rng.uniform(*fam["web_width_rel"])) * width
        geometry["flange_height"] = float(rng.uniform(*fam["flange_height_rel_height"])) * height
        max_fillet = 0.5 * min(width - geometry["web_width"], height - geometry["flange_height"])
        lo, hi = fam["fillet_radius_rel"]
        geometry["fillet_radius"] = min(float(rng.uniform(lo, hi)) * width, max_fillet)
    base = {
        "schema": "physix.case/1",
        "family": family,
        "geometry": geometry,
        "thickness": width * float(rng.uniform(0.01, 0.04)),
        "material": _material(rng, d["poisson"]),
        "support": "clamped",
        "load": _load(rng),
    }
    weights = HOLE_COUNT_WEIGHTS[family]
    n = int(rng.choice(len(weights), p=weights))
    holes = _place_holes(rng, base, n, fam["hole_radius_rel"], d["hole_clearance_rel"])
    if holes is None:
        return None
    geometry["holes"] = holes
    return base


def jitter_variant(
    rng: np.random.Generator, base: dict[str, Any], domain: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """A related design: same outline, holes moved by up to 0.05 x width, radius +-15 %."""
    d = domain or DOMAIN
    w = base["geometry"]["width"]
    holes = [
        {
            "x": h["x"] + float(rng.uniform(-0.05, 0.05)) * w,
            "y": h["y"] + float(rng.uniform(-0.05, 0.05)) * w,
            "radius": h["radius"] * float(rng.uniform(0.85, 1.15)),
        }
        for h in base["geometry"]["holes"]
    ]
    variant = {**base, "geometry": {**base["geometry"], "holes": holes}}
    variant["material"] = _material(rng, d["poisson"])
    try:
        case = case_from_dict(variant)
    except CaseValidationError:
        return None
    return variant if check_domain(case, d).in_domain else None


def group_id(seed: int, family: str, index: int) -> str:
    return "grp_" + hashlib.sha256(f"{seed}:{family}:{index}".encode()).hexdigest()[:12]


def assign_split(group: str, fractions: dict[str, float]) -> str:
    """Deterministic split assignment by hashed group identity."""
    u = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    acc = 0.0
    for name, frac in fractions.items():
        acc += frac
        if u < acc:
            return name
    return list(fractions)[-1]


def sample_shifted_plate(rng: np.random.Generator) -> dict[str, Any] | None:
    """Out-of-domain probe: a plate with one hole larger than the trained radius range."""
    shifted = {
        **DOMAIN,
        "plate": {**DOMAIN["plate"], "hole_radius_rel": [0.11, 0.14]},
    }
    for _ in range(50):
        base = sample_base(rng, "plate", shifted)
        if base is not None and len(base["geometry"]["holes"]) >= 1:
            base["geometry"]["holes"] = base["geometry"]["holes"][:1]
            return base
    return None
