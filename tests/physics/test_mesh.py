import numpy as np
import pytest

from physics.examples import example_bracket, example_plate
from physics.geometry import signed_distance, solid_area
from physics.mesh import MESH_PRESETS, build_mesh


@pytest.fixture(scope="module", params=["plate", "bracket"])
def tagged(request):
    case = example_plate() if request.param == "plate" else example_bracket()
    return case, build_mesh(case, MESH_PRESETS["fast"])


def test_mesh_is_deterministic():
    case = example_plate()
    a = build_mesh(case, MESH_PRESETS["fast"])
    b = build_mesh(case, MESH_PRESETS["fast"])
    np.testing.assert_array_equal(a.points, b.points)
    np.testing.assert_array_equal(a.triangles, b.triangles)


def test_boundary_tags_present(tagged):
    case, mesh = tagged
    expected = {"support", "load", "free"} | {f"hole{i}" for i in range(len(case.geometry.holes))}
    if case.family == "bracket":
        expected.add("fillet")
    assert expected == set(mesh.boundary_edges)


def test_tagged_nodes_lie_on_their_boundaries(tagged):
    case, mesh = tagged
    p = mesh.points
    sup = p[np.unique(mesh.boundary_edges["support"])]
    load = p[np.unique(mesh.boundary_edges["load"])]
    if case.family == "plate":
        np.testing.assert_allclose(sup[:, 0], 0.0, atol=1e-12)
        np.testing.assert_allclose(load[:, 0], case.geometry.width, atol=1e-12)
    else:
        np.testing.assert_allclose(sup[:, 1], case.geometry.height, atol=1e-12)
        np.testing.assert_allclose(load[:, 0], case.geometry.width, atol=1e-12)
    for i, hole in enumerate(case.geometry.holes):
        hp = p[np.unique(mesh.boundary_edges[f"hole{i}"])]
        r = np.hypot(hp[:, 0] - hole.x, hp[:, 1] - hole.y)
        np.testing.assert_allclose(r, hole.radius, rtol=1e-12)


def test_tagged_edge_lengths_cover_boundaries(tagged):
    case, mesh = tagged
    p = mesh.points
    e = mesh.boundary_edges["load"]
    length = np.linalg.norm(p[e[:, 0]] - p[e[:, 1]], axis=1).sum()
    assert length == pytest.approx(case.load_edge_length)
    e = mesh.boundary_edges["support"]
    length = np.linalg.norm(p[e[:, 0]] - p[e[:, 1]], axis=1).sum()
    assert length == pytest.approx(case.support_edge_length)


def test_mesh_area_and_quality(tagged):
    case, mesh = tagged
    p = mesh.points[mesh.triangles]
    area = 0.5 * (
        (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1])
        - (p[:, 2, 0] - p[:, 0, 0]) * (p[:, 1, 1] - p[:, 0, 1])
    )
    assert np.all(area > 0), "triangles must be counter-clockwise"
    # Polygonal hole and fillet approximations change area slightly.
    assert area.sum() == pytest.approx(solid_area(case), rel=5e-3)
    centroids = p.mean(axis=1)
    assert np.all(signed_distance(case, centroids[:, 0], centroids[:, 1]) < 1e-4)
    assert mesh.quality()["min_angle_deg"] > 5.0


def test_refined_settings_increase_node_count():
    case = example_plate()
    coarse = build_mesh(case, MESH_PRESETS["fast"])
    fine = build_mesh(case, MESH_PRESETS["fast"].refined(1.5))
    assert fine.n_nodes > 1.5 * coarse.n_nodes
