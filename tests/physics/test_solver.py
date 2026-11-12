"""Reference solver checks: analytic cases, equilibrium, linearity and convergence."""

import numpy as np
import pytest

from physics.case import case_from_dict
from physics.convergence import check_convergence
from physics.examples import bracket_dict, example_bracket, example_plate, plate_dict
from physics.mesh import MESH_PRESETS
from physics.solver import solve, solve_unit, von_mises


def _square(holes, support="roller", traction=(1e6, 0.0)):
    return case_from_dict(
        {
            "family": "plate",
            "geometry": {"width": 1.0, "height": 1.0, "holes": holes},
            "thickness": 0.01,
            "material": {"young": 200e9, "poisson": 0.3},
            "support": support,
            "load": {"kind": "traction", "x": traction[0], "y": traction[1]},
        }
    )


def test_uniform_tension_is_exact_with_roller_support():
    sol = solve(_square([]), MESH_PRESETS["fast"])
    v = sol.stress.values
    np.testing.assert_allclose(v[..., 0], 1e6, rtol=1e-8)
    np.testing.assert_allclose(v[..., 1], 0.0, atol=1e-3)
    np.testing.assert_allclose(v[..., 2], 0.0, atol=1e-3)
    # Analytic elongation u_x(L) = T L / E at the loaded edge.
    right = np.isclose(sol.mesh.points[:, 0], 1.0)
    np.testing.assert_allclose(sol.displacement[right, 0], 1e6 / 200e9, rtol=1e-8)


def test_kirsch_hole_concentration_factor():
    # d/W = 0.1: finite-width (Howland) gross-section factor is about 3.03.
    sol = solve(_square([{"x": 0.5, "y": 0.5, "radius": 0.05}]), MESH_PRESETS["reference"])
    kt = sol.hotspot()["stress_concentration"]
    assert kt == pytest.approx(3.03, rel=0.03)
    hs = sol.hotspot()
    assert abs(hs["x"] - 0.5) < 0.01 and abs(abs(hs["y"] - 0.5) - 0.05) < 0.005


@pytest.mark.parametrize("factory", [example_plate, example_bracket])
def test_reactions_balance_applied_force(factory):
    sol = solve(factory(), MESH_PRESETS["fast"])
    summary = sol.summary()
    fx, fy = summary["applied_force"]
    rx, ry = summary["reaction_force"]
    assert rx == pytest.approx(-fx, abs=1e-6 * max(abs(fx), abs(fy)))
    assert ry == pytest.approx(-fy, abs=1e-6 * max(abs(fx), abs(fy)))
    assert summary["equilibrium_residual"] < 1e-8


def test_stress_scales_linearly_with_load():
    case = example_plate()
    a = solve(case, MESH_PRESETS["fast"])
    b = solve(case.scaled_load(3.0), MESH_PRESETS["fast"])
    np.testing.assert_allclose(b.stress.values, 3.0 * a.stress.values, rtol=1e-9, atol=1e-6)
    np.testing.assert_allclose(b.displacement, 3.0 * a.displacement, rtol=1e-9, atol=1e-18)


def test_superposition_of_unit_loads():
    data = plate_dict()
    data["load"] = {"kind": "traction", "x": 4e6, "y": -2e6}
    case = case_from_dict(data)
    unit = solve_unit(case, MESH_PRESETS["fast"])
    combined = unit.combine().stress.values
    v = unit.stress.values
    np.testing.assert_allclose(combined, 4e6 * v[..., :3] - 2e6 * v[..., 3:], rtol=1e-12)


def test_stress_independent_of_young_and_thickness_for_traction_load():
    a_data = plate_dict()
    b_data = plate_dict()
    b_data["material"]["young"] = 70e9
    b_data["thickness"] = 0.002
    a = solve(case_from_dict(a_data), MESH_PRESETS["fast"])
    b = solve(case_from_dict(b_data), MESH_PRESETS["fast"])
    np.testing.assert_allclose(a.stress.values, b.stress.values, rtol=1e-8, atol=1e-3)
    np.testing.assert_allclose(b.displacement, a.displacement * 3.0, rtol=1e-8, atol=1e-15)


def test_bracket_hotspot_is_at_fillet():
    sol = solve(example_bracket(), MESH_PRESETS["fast"])
    hs = sol.hotspot()
    g = example_bracket().geometry
    cx, cy = g.web_width + g.fillet_radius, g.flange_height + g.fillet_radius
    assert np.hypot(hs["x"] - cx, hs["y"] - cy) == pytest.approx(g.fillet_radius, abs=2e-3)


def test_sample_matches_element_values_at_centroids():
    sol = solve(example_plate(), MESH_PRESETS["fast"])
    p = sol.mesh.points[sol.mesh.triangles]
    c = p.mean(axis=1)[:50]
    sampled = sol.stress.sample(c[:, 0], c[:, 1])
    np.testing.assert_allclose(sampled, sol.stress.values[:50].mean(axis=1), rtol=1e-9)


def test_cantilever_bending_matches_beam_theory():
    """Regression for vertex ordering: pointwise stress must follow M y / I."""
    length, depth, ty = 1.0, 0.1, -1e5
    case = case_from_dict(
        {
            "family": "plate",
            "geometry": {"width": length, "height": depth, "holes": []},
            "thickness": 0.01,
            "material": {"young": 200e9, "poisson": 0.3},
            "load": {"kind": "traction", "x": 0.0, "y": ty},
        }
    )
    sol = solve(case, MESH_PRESETS["reference"])
    x = 0.5
    ys = np.linspace(0.01, 0.09, 9)
    sampled = sol.stress.sample(np.full_like(ys, x), ys)[:, 0]
    moment = ty * depth * (length - x)  # per unit thickness
    expected = -moment * (ys - depth / 2) / (depth**3 / 12)
    np.testing.assert_allclose(sampled, expected, atol=0.01 * np.abs(expected).max())


def test_von_mises_formula():
    assert von_mises(np.array(1.0), np.array(0.0), np.array(0.0)) == pytest.approx(1.0)
    assert von_mises(np.array(0.0), np.array(0.0), np.array(1.0)) == pytest.approx(np.sqrt(3))
    assert von_mises(np.array(1.0), np.array(1.0), np.array(0.0)) == pytest.approx(1.0)


@pytest.mark.parametrize("factory", [plate_dict, bracket_dict])
def test_reference_mesh_is_converged(factory):
    report = check_convergence(case_from_dict(factory()))
    assert report.converged, report.to_dict()
