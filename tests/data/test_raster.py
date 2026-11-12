import json
from pathlib import Path

import numpy as np
import pytest

from data.fixtures import build_fixture
from data.raster import (
    COLS,
    ROWS,
    combine_targets,
    encode_features,
    fits_frame,
    pixel_centres,
    raster_hotspot,
    raster_von_mises,
    rasterize_unit_solution,
    solid_mask,
)
from physics.case import case_from_dict
from physics.examples import example_bracket, example_plate, plate_dict
from physics.solver import solve_unit

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "encoding_v1.json"


def test_row_zero_is_top_and_units_are_metres():
    case = example_plate()
    px, py = pixel_centres(case)
    dx = case.geometry.width / COLS
    assert px[0, 0] == pytest.approx(0.5 * dx)
    assert py[0, 0] == pytest.approx((ROWS - 0.5) * dx)
    assert py[-1, 0] == pytest.approx(0.5 * dx)
    assert px[0, -1] == pytest.approx(case.geometry.width - 0.5 * dx)


def test_mask_matches_geometry_area():
    for case in (example_plate(), example_bracket()):
        mask = solid_mask(case)
        dx = case.geometry.width / COLS
        from physics.geometry import solid_area

        assert mask.sum() * dx * dx == pytest.approx(solid_area(case), rel=0.03)
        # The hole centre is void, a point well inside the solid is material.
        hole = case.geometry.holes[0]
        j = int(hole.x / dx)
        i = ROWS - 1 - int(hole.y / dx)
        assert not mask[i, j]


def test_feature_channels_ranges():
    feats = encode_features(example_bracket())
    assert feats.shape == (7, ROWS, COLS) and feats.dtype == np.float32
    assert set(np.unique(feats[0])) <= {0.0, 1.0}
    assert feats[1].min() >= -1 and feats[1].max() <= 1
    assert np.all((feats[4] > 0) & (feats[4] <= 1)) and np.all((feats[5] > 0) & (feats[5] <= 1))
    np.testing.assert_allclose(feats[6], (0.33 - 0.3) / 0.1, rtol=1e-6)
    # Support edge of the plate is x = 0: proximity is largest in column 0.
    plate = encode_features(example_plate())
    assert plate[4][:, 0].mean() > plate[4][:, -1].mean()
    assert plate[5][:, -1].mean() > plate[5][:, 0].mean()


def test_tall_parts_do_not_fit_frame():
    data = plate_dict()
    data["geometry"]["height"] = 0.12  # 0.6 x width
    data["geometry"]["holes"] = []
    assert not fits_frame(case_from_dict(data))
    assert fits_frame(example_plate())


def test_encoding_matches_committed_fixture():
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    fresh = build_fixture()
    assert committed["pixels"] == fresh["pixels"]
    for a, b in zip(committed["cases"], fresh["cases"], strict=True):
        np.testing.assert_allclose(a["values"], b["values"], atol=1e-6)
        np.testing.assert_allclose(a["channel_sums"], b["channel_sums"], rtol=1e-6)


def test_rasterised_targets_are_masked_and_combine_linearly():
    case = example_plate()
    unit = solve_unit(case, "fast")
    targets, mask = rasterize_unit_solution(unit)
    assert targets.shape == (6, ROWS, COLS)
    assert np.all(targets[:, ~mask] == 0) and np.all(np.isfinite(targets))
    stress = combine_targets(targets, case.traction())
    sol = unit.combine()
    px, py = pixel_centres(case)
    direct = sol.stress.sample(px[mask], py[mask])
    np.testing.assert_allclose(stress[:, mask].T, direct, rtol=1e-4, atol=1e-2)
    vm = raster_von_mises(stress)
    hs = raster_hotspot(vm, mask, case)
    # Raster hotspot is close to the mesh hotspot at the hole edge (sampled at pixel centres).
    assert hs["von_mises"] == pytest.approx(sol.hotspot()["von_mises"], rel=0.15)
    assert abs(hs["x"] - case.geometry.holes[0].x) < 0.02
