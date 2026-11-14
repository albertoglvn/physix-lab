"""Line probes, section resultants and the closed-form stress-concentration references."""

import json
from pathlib import Path

import numpy as np
import pytest

from data.fixtures import LINE_PROBES, build_line_probe_fixture, decode_mesh
from physics.examples import example_plate, plate_dict
from physics.mesh import MESH_PRESETS
from physics.probe import (
    KIRSCH_KT,
    SECTION_SAMPLES,
    heywood_kt_gross,
    heywood_kt_net,
    line_points,
    probe_line,
    sample_exact,
    section_normal,
    section_resultant,
)
from physics.solver import ElementField, solve

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "line_probe_v1.json"


@pytest.fixture(scope="module")
def plate_solution():
    return solve(example_plate(), MESH_PRESETS["fast"])


def test_line_points_include_both_ends_and_reject_bad_lines():
    pts = line_points((0.0, 0.0), (0.1, 0.05), 11)
    assert pts.shape == (11, 2)
    np.testing.assert_allclose(pts[0], [0.0, 0.0])
    np.testing.assert_allclose(pts[-1], [0.1, 0.05])
    np.testing.assert_allclose(np.diff(pts[:, 0]), 0.01)
    with pytest.raises(ValueError, match="two points"):
        line_points((0, 0), (1, 1), 1)
    with pytest.raises(ValueError, match="distinct"):
        line_points((0.2, 0.1), (0.2, 0.1), 5)


def test_exact_sampling_reproduces_a_linear_field_and_marks_outside_points():
    # Two triangles covering the unit square; a linear field is represented exactly.
    points = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
    triangles = np.array([[0, 1, 2], [0, 2, 3]])
    f = lambda p: np.stack([1 + 2 * p[..., 0] - p[..., 1], 3 * p[..., 1], p[..., 0]], axis=-1)  # noqa: E731
    field = ElementField(points, triangles, f(points[triangles]))
    query = np.array([[0.25, 0.6], [0.9, 0.1], [0.5, 0.5], [1.2, 0.5], [-0.01, 0.2]])
    out = sample_exact(field, query)
    np.testing.assert_allclose(out[:3], f(query[:3]), atol=1e-12)
    assert np.isnan(out[3:]).all()


def test_probe_equals_fem_point_evaluation(plate_solution):
    profile = probe_line(plate_solution.stress, (0.1, 0.0), (0.1, 0.08), 161)
    pts = np.column_stack([profile["x"], profile["y"]])
    inside = np.isfinite(profile["sxx"])
    reference = plate_solution.stress.sample(pts[inside, 0], pts[inside, 1])
    peak = np.nanmax(profile["von_mises"])
    probed = np.column_stack([profile[k][inside] for k in ("sxx", "syy", "txy")])
    np.testing.assert_allclose(probed, reference, atol=1e-9 * peak)
    # The hole interior is void on the probe: |y − 0.04| < r, less the polygonal chord band.
    hole = np.abs(profile["y"] - 0.04) < 0.0115
    assert np.isnan(profile["sxx"][hole]).all()
    assert np.isfinite(profile["sxx"][~hole & (np.abs(profile["y"] - 0.04) > 0.0125)]).all()


def test_net_section_carries_the_applied_force(plate_solution):
    case = example_plate()
    profile = probe_line(plate_solution.stress, (0.1, 0.0), (0.1, 0.08), SECTION_SAMPLES)
    fx, fy = section_resultant(case, profile)
    applied_x, _ = case.resultant_force()
    assert fx == pytest.approx(applied_x, rel=0.01)
    assert abs(fy) < 0.01 * applied_x
    # The normal points towards the load edge whichever way the line is drawn.
    np.testing.assert_allclose(section_normal(case, (0.1, 0.08), (0.1, 0.0)), [1.0, 0.0])
    np.testing.assert_allclose(section_normal(case, (0.1, 0.0), (0.1, 0.08)), [1.0, 0.0])


def test_heywood_reference_and_fem_kt():
    assert heywood_kt_net(0.0) == pytest.approx(KIRSCH_KT)
    assert heywood_kt_net(0.3) == pytest.approx(2.343)
    assert heywood_kt_gross(0.3) == pytest.approx(2.343 / 0.7)
    with pytest.raises(ValueError):
        heywood_kt_net(1.0)
    # The canonical plate (d/W = 24/80) on the reference mesh is within 3 % of Heywood.
    sol = solve(example_plate(), MESH_PRESETS["reference"])
    assert sol.hotspot()["stress_concentration"] == pytest.approx(heywood_kt_gross(0.3), rel=0.03)


def test_line_probe_fixture_is_self_consistent():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fixture["case"] == plate_dict()
    assert {p["name"] for p in fixture["probes"]} == set(LINE_PROBES)
    field = decode_mesh(fixture["mesh"])
    assert field.values.shape == (fixture["mesh"]["n_triangles"], 3, 3)
    for probe in fixture["probes"]:
        profile = probe_line(field, probe["a"], probe["b"], probe["n"])
        for key, stored in probe["values"].items():
            expected = np.array([np.nan if v is None else v for v in stored])
            np.testing.assert_allclose(profile[key], expected, rtol=1e-12, equal_nan=True)


def test_line_probe_fixture_matches_a_fresh_solve():
    # Meshing can differ in the last bits between platforms, so compare with a tolerance.
    fresh = build_line_probe_fixture()
    stored = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fresh["solver"]["mesh_preset"] == stored["solver"]["mesh_preset"]
    for a, b in zip(fresh["probes"], stored["probes"], strict=True):
        np.testing.assert_allclose(
            a["section_resultant"], b["section_resultant"], rtol=1e-3, atol=1.0
        )
