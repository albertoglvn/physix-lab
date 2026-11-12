import hashlib
import json

import numpy as np
import pytest
import torch

from data.raster import COLS, ROWS, encode_features, solid_mask
from model.calibrate import calibrate_threshold, decide
from model.ensemble import ensemble_statistics, field_errors
from model.export import export_member
from model.runtime import BundleError, OnnxEnsemble
from model.train import fit_normalization, relative_loss, split_train_val
from model.unet import PhysicalModel, UNet
from physics.examples import example_bracket, example_plate


def _tiny_model(seed: int = 0) -> PhysicalModel:
    torch.manual_seed(seed)
    net = UNet(base=4, depth=3)
    model = PhysicalModel(net, torch.zeros(6), torch.full((6,), 2.0))
    model.eval()
    return model


def test_unet_shapes_and_masking():
    model = _tiny_model()
    feats = torch.from_numpy(
        np.stack([encode_features(example_plate()), encode_features(example_bracket())])
    )
    with torch.no_grad():
        out = model(feats)
    assert out.shape == (2, 6, ROWS, COLS)
    mask = feats[:, 0:1].expand_as(out)
    assert torch.all(out[mask == 0] == 0)


def test_normalization_uses_only_solid_pixels_of_given_rows():
    targets = np.zeros((3, 6, ROWS, COLS), dtype=np.float32)
    masks = np.zeros((3, ROWS, COLS), dtype=bool)
    masks[:, :10] = True
    targets[0][:, masks[0]] = 2.0
    targets[1][:, masks[1]] = 4.0
    targets[2][:, :, :] = 1000.0  # excluded row
    targets[0][:, ~masks[0]] = 99.0  # excluded pixels
    norm = fit_normalization(targets, masks, np.array([0, 1]))
    np.testing.assert_allclose(norm["mean"], 3.0)
    np.testing.assert_allclose(norm["std"], 1.0)


def test_relative_loss_is_scale_invariant_and_masked():
    ref = torch.randn(2, 6, ROWS, COLS)
    pred = ref + 0.1 * torch.randn_like(ref)
    mask = torch.ones(2, 1, ROWS, COLS)
    a = relative_loss(pred, ref, mask)
    b = relative_loss(50 * pred, 50 * ref, mask)
    assert float(a) == pytest.approx(float(b), rel=1e-4)
    assert float(relative_loss(ref, ref, mask)) == pytest.approx(0.0, abs=1e-10)
    mask[:, :, :5] = 0
    noisy = pred.clone()
    noisy[:, :, :5] += 1e3  # errors outside the mask are ignored
    assert float(relative_loss(noisy, ref, mask)) < 1.0


def test_validation_split_is_grouped():
    records = [{"group": f"g{i // 3}"} for i in range(300)]
    fit, val = split_train_val(records, np.arange(300))
    assert len(fit) + len(val) == 300 and len(val) > 0
    fit_groups = {records[i]["group"] for i in fit}
    assert not fit_groups & {records[i]["group"] for i in val}


def test_calibration_picks_largest_admissible_threshold():
    d = np.linspace(0.0, 1.0, 101)
    e = np.where(d <= 0.5, 0.05, 0.5)  # error jumps above disagreement 0.5
    policy = calibrate_threshold(d, e, target=0.1, quantile=0.9)
    assert 0.5 <= policy["threshold"] < 0.6
    assert policy["calibration"]["accepted_hotspot_error_quantile"] <= 0.1
    assert decide(policy, 0.2, True) == (True, None)
    assert decide(policy, 0.9, True) == (False, "high_disagreement")
    assert decide(policy, 0.2, False) == (False, "out_of_domain")
    assert decide(policy, float("nan"), True) == (False, "non_finite_prediction")


def test_calibration_with_no_admissible_threshold_rejects_everything():
    policy = calibrate_threshold(np.linspace(0, 1, 50), np.full(50, 0.9))
    assert policy["threshold"] < 0 and policy["calibration"]["coverage"] == 0.0


def test_ensemble_statistics_identical_members_have_zero_disagreement():
    case = example_plate()
    mask = solid_mask(case)
    field = np.zeros((6, ROWS, COLS))
    field[0][mask] = 1.0
    members = np.stack([field] * 5)
    res = ensemble_statistics(members, mask, case)
    assert res.disagreement == pytest.approx(0.0)
    assert res.hotspot["von_mises"] == pytest.approx(case.traction()[0])
    scaled = members * np.array([0.9, 0.95, 1.0, 1.05, 1.1])[:, None, None, None]
    assert ensemble_statistics(scaled, mask, case).disagreement == pytest.approx(
        np.std([0.9, 0.95, 1.0, 1.05, 1.1]), rel=1e-6
    )
    errs = field_errors(res.mean, res.mean, mask)
    assert errs["component_rel_l2"] == 0.0


def test_onnx_export_parity_and_bundle_runtime(tmp_path):
    members = []
    for k in range(2):
        model = _tiny_model(seed=k)
        path = tmp_path / f"member_{k}.onnx"
        export_member(model, path)
        members.append(
            {
                "member": k,
                "file": path.name,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    manifest = {
        "schema": "physix.model/1",
        "model_id": "test",
        "members": members,
        "fallback_policy": {"threshold": 0.1},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    ens = OnnxEnsemble(tmp_path, threads=1)
    case = example_bracket()
    feats = encode_features(case)[None]
    out = ens.run(feats)
    with torch.no_grad():
        ref = _tiny_model(seed=1)(torch.from_numpy(feats)).numpy()
    np.testing.assert_allclose(out[1], ref, atol=1e-5 * max(1.0, float(np.abs(ref).max())))
    result, mask, timing = ens.predict(case)
    assert result.mean.shape == (3, ROWS, COLS) and mask.shape == (ROWS, COLS)
    assert set(timing) == {"encode_ms", "inference_ms", "postprocess_ms"}

    (tmp_path / "member_0.onnx").write_bytes(b"tampered")
    with pytest.raises(BundleError, match="hash"):
        OnnxEnsemble(tmp_path)
