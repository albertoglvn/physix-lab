import json

import numpy as np
import pytest

from data.dataset import load_dataset
from data.generate import generate
from data.labels import ingest_label, list_labels, load_label, retraining_candidates
from data.raster import COLS, ROWS
from physics.examples import example_plate


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("ds")
    manifest = generate(
        out, seed=4, groups=3, variants=2, shifted=1, workers=2, preset="fast", pilot=1
    )
    return out, manifest


def test_generated_dataset_is_complete_and_versioned(tiny_dataset):
    out, manifest = tiny_dataset
    ds = load_dataset(out)
    n = manifest["counts"]["cases"]
    assert manifest["counts"]["failed"] == 0
    assert ds.targets.shape == (n, 6, ROWS, COLS) and ds.masks.shape == (n, ROWS, COLS)
    assert manifest["dataset_id"].startswith("physix-ds-")
    assert manifest["raster"]["row_order"] == "top_to_bottom"
    assert manifest["solver"]["mesh_preset"] == "fast"
    assert len(manifest["pilot_convergence"]) == 1
    for i, rec in enumerate(ds.records):
        assert np.all(np.isfinite(ds.targets[i]))
        assert np.all(ds.targets[i][:, ~ds.masks[i]] == 0)
        assert ds.masks[i].sum() > 0
        assert rec["case_id"] == ds.case(i).case_id()
    feats = ds.features()
    np.testing.assert_array_equal(feats[:, 0] > 0.5, ds.masks)


def test_generation_is_reproducible(tiny_dataset, tmp_path):
    out, manifest = tiny_dataset
    again = generate(
        tmp_path, seed=4, groups=3, variants=2, shifted=1, workers=1, preset="fast", pilot=0
    )
    assert again["dataset_id"] == manifest["dataset_id"]
    np.testing.assert_array_equal(np.load(out / "targets.npy"), np.load(tmp_path / "targets.npy"))
    a = [json.loads(x)["case_id"] for x in (out / "cases.jsonl").read_text().splitlines()]
    b = [json.loads(x)["case_id"] for x in (tmp_path / "cases.jsonl").read_text().splitlines()]
    assert a == b


def test_label_intake_is_idempotent(tmp_path):
    case = example_plate()
    targets = np.ones((6, ROWS, COLS), dtype=np.float32)
    mask = np.ones((ROWS, COLS), dtype=bool)
    prov = {"source": "fem_fallback", "solver": "scikit-fem"}
    first = ingest_label(tmp_path, case, targets, mask, prov)
    second = ingest_label(tmp_path, case, targets * 2, mask, prov)
    assert first["status"] == "added" and second["status"] == "duplicate"
    assert len(list_labels(tmp_path)) == 1
    loaded_case, t, m = load_label(tmp_path, case.case_id())
    assert loaded_case.case_id() == case.case_id()
    np.testing.assert_array_equal(t, targets)
    assert retraining_candidates(tmp_path, [case.case_id()]) == []
    assert retraining_candidates(tmp_path, []) == [case.case_id()]


def test_label_intake_rejects_bad_arrays(tmp_path):
    case = example_plate()
    with pytest.raises(ValueError, match="grid"):
        ingest_label(tmp_path, case, np.zeros((6, 10, 10)), np.ones((10, 10), bool), {})
    bad = np.full((6, ROWS, COLS), np.nan, dtype=np.float32)
    with pytest.raises(ValueError, match="non-finite"):
        ingest_label(tmp_path, case, bad, np.ones((ROWS, COLS), bool), {})
