"""Canonical example cases used by tests, fixtures, documentation and demos."""

from __future__ import annotations

from typing import Any

from physics.case import Case, case_from_dict


def plate_dict() -> dict[str, Any]:
    """Steel plate, 200 x 80 x 5 mm, one 24 mm hole, clamped left, 10 MPa tension."""
    return {
        "schema": "physix.case/1",
        "family": "plate",
        "geometry": {
            "width": 0.2,
            "height": 0.08,
            "holes": [{"x": 0.1, "y": 0.04, "radius": 0.012}],
        },
        "thickness": 0.005,
        "material": {"name": "steel", "young": 210e9, "poisson": 0.3},
        "support": "clamped",
        "load": {"kind": "traction", "x": 10e6, "y": 0.0},
    }


def bracket_dict() -> dict[str, Any]:
    """Aluminium L-bracket hung from its web, 500 N downward force at the flange tip."""
    return {
        "schema": "physix.case/1",
        "family": "bracket",
        "geometry": {
            "width": 0.2,
            "height": 0.1,
            "web_width": 0.04,
            "flange_height": 0.03,
            "fillet_radius": 0.008,
            "holes": [{"x": 0.02, "y": 0.07, "radius": 0.008}],
        },
        "thickness": 0.005,
        "material": {"name": "aluminium_6061", "young": 68.9e9, "poisson": 0.33},
        "support": "clamped",
        "load": {"kind": "force", "x": 0.0, "y": -500.0},
    }


def example_plate() -> Case:
    return case_from_dict(plate_dict())


def example_bracket() -> Case:
    return case_from_dict(bracket_dict())
