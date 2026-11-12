import math

import numpy as np
import pytest

from physics.case import CaseValidationError, case_from_dict
from physics.examples import bracket_dict, example_bracket, example_plate, plate_dict
from physics.geometry import (
    distance_to_outer_boundary,
    outer_curves,
    signed_distance,
    solid_area,
)


def test_plate_sdf_signs_and_values():
    case = example_plate()
    px = np.array([0.05, 0.1, 0.1, -0.01, 0.1])
    py = np.array([0.04, 0.04, 0.04 + 0.012 + 0.001, 0.04, 0.081])
    d = signed_distance(case, px, py)
    assert d[0] < 0  # solid
    assert d[1] == pytest.approx(0.012)  # hole centre, outside the solid
    assert d[2] < 0  # just outside the hole: solid
    assert d[3] == pytest.approx(0.01)
    assert d[4] == pytest.approx(0.001)


def test_bracket_sdf_fillet_region():
    case = example_bracket()
    # Point inside the fillet corner material (near the corner, outside the arc).
    assert signed_distance(case, np.array([0.0405]), np.array([0.0305]))[0] < 0
    # Point in the void region beyond the fillet arc.
    assert signed_distance(case, np.array([0.047]), np.array([0.037]))[0] > 0
    # Upper right void.
    assert signed_distance(case, np.array([0.15]), np.array([0.08]))[0] > 0


def test_outer_curves_form_closed_loop():
    for case in (example_plate(), example_bracket()):
        curves = outer_curves(case)
        tags = {c.tag for c in curves}
        assert {"support", "load", "free"} <= tags
        assert sum(c.tag == "support" for c in curves) == 1


def test_solid_area_matches_monte_carlo():
    rng = np.random.default_rng(0)
    for case in (example_plate(), example_bracket()):
        g = case.geometry
        n = 200_000
        px = rng.random(n) * g.width
        py = rng.random(n) * g.height
        frac = np.mean(signed_distance(case, px, py) < 0)
        assert frac * g.width * g.height == pytest.approx(solid_area(case), rel=0.01)


def test_distance_to_outer_boundary_is_euclidean():
    case = example_plate()
    d = distance_to_outer_boundary(case, np.array([0.1]), np.array([0.03]))
    assert d[0] == pytest.approx(0.03)


def test_hole_clearance_limits():
    data = plate_dict()
    data["geometry"]["holes"] = [{"x": 0.1, "y": 0.0135, "radius": 0.012}]
    with pytest.raises(CaseValidationError, match="ligament"):
        case_from_dict(data)
    data["geometry"]["holes"] = [{"x": 0.1, "y": 0.0145, "radius": 0.012}]
    case_from_dict(data)


def test_overlapping_holes_are_rejected():
    data = plate_dict()
    data["geometry"]["holes"] = [
        {"x": 0.08, "y": 0.04, "radius": 0.012},
        {"x": 0.105, "y": 0.04, "radius": 0.012},
    ]
    with pytest.raises(CaseValidationError, match="holes\\[0\\]"):
        case_from_dict(data)


def test_hole_outside_part_is_rejected():
    data = bracket_dict()
    data["geometry"]["holes"] = [{"x": 0.15, "y": 0.08, "radius": 0.005}]
    with pytest.raises(CaseValidationError, match="outside"):
        case_from_dict(data)


def test_tiny_hole_is_rejected():
    data = plate_dict()
    data["geometry"]["holes"] = [{"x": 0.1, "y": 0.04, "radius": 0.0005}]
    with pytest.raises(CaseValidationError, match="radius"):
        case_from_dict(data)


@pytest.mark.parametrize(
    ("key", "value"),
    [("web_width", 0.19), ("flange_height", 0.09), ("fillet_radius", 0.06)],
)
def test_bracket_parameter_limits(key, value):
    data = bracket_dict()
    data["geometry"]["holes"] = []
    data["geometry"][key] = value
    with pytest.raises(CaseValidationError, match=key):
        case_from_dict(data)


def test_fillet_area_term():
    case = example_bracket()
    g = case.geometry
    expected = (
        g.web_width * g.height
        + (g.width - g.web_width) * g.flange_height
        + g.fillet_radius**2 * (1 - math.pi / 4)
        - math.pi * g.holes[0].radius ** 2
    )
    assert solid_area(case) == pytest.approx(expected)
