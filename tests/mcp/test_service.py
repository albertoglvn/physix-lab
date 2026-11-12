"""Service routing, provenance, fallback, label intake, verification and optimization."""

from __future__ import annotations

import base64
from typing import Any

import numpy as np
import pytest
from physix_mcp import service as service_module
from physix_mcp.optimize import parse_request
from physix_mcp.service import PREDICTION_SCHEMA, PhysixService

from data.raster import COLS, ROWS, solid_mask
from model.ensemble import ensemble_statistics
from physics.case import Case, case_from_dict
from physics.examples import bracket_dict, plate_dict


class FakeEnsemble:
    """Controllable predictor: smooth unit field with a chosen member spread."""

    def __init__(self, spread: float, threshold: float = 0.05) -> None:
        self.spread = spread
        self.model_id = "physix-unet5-test"
        self.manifest = {"model_id": self.model_id, "dataset_id": "physix-ds-test"}
        self.policy = {"threshold": threshold, "metric": "hotspot_von_mises_cv"}
        self.calls = 0

    def predict(self, case: Case):
        self.calls += 1
        mask = solid_mask(case)
        yy, xx = np.mgrid[0:ROWS, 0:COLS]
        base = np.zeros((6, ROWS, COLS), dtype=np.float32)
        base[0] = 1.0 + 0.5 * np.sin(xx / 20.0)
        base[4] = 0.2
        members = np.stack([base * (1.0 + self.spread * (k - 2)) for k in range(5)]) * mask
        result = ensemble_statistics(members, mask, case)
        return result, mask, {"encode_ms": 0.1, "inference_ms": 1.0, "postprocess_ms": 0.1}


def make_service(tmp_path, ensemble=None, **kw: Any) -> PhysixService:
    svc = PhysixService(
        tmp_path / "no-bundle", label_store=tmp_path / "labels", fem_preset="fast", **kw
    )
    svc.ensemble = ensemble
    return svc


def decode(field: dict[str, Any]) -> np.ndarray:
    raw = np.frombuffer(base64.b64decode(field["data"]), dtype="<f4")
    return raw.reshape(field["shape"])


def test_invalid_and_unsupported_cases_are_structured_errors(tmp_path) -> None:
    svc = make_service(tmp_path)
    bad = svc.predict({"family": "plate"})
    assert bad["error"] == "invalid_case" and bad["field"] == "geometry"
    case = plate_dict() | {"analysis": {"type": "modal"}}
    unsupported = svc.predict(case)
    assert unsupported["error"] == "unsupported_case"
    assert svc.verify({"family": "disc"})["error"] == "invalid_case"


def test_missing_model_falls_back_to_solver_and_labels_idempotently(tmp_path) -> None:
    svc = make_service(tmp_path)
    assert svc.health()["model_id"] is None
    first = svc.predict(plate_dict())
    assert first["schema"] == PREDICTION_SCHEMA
    assert first["source"] == "fem_fallback"
    assert first["fallback"] == {"used": True, "reason": "model_unavailable"}
    assert first["summary"]["hotspot_basis"] == "mesh"
    assert first["solver"]["name"] == "scikit-fem"
    assert first["label"]["status"] == "added"
    eq = first["summary"]["equilibrium_residual"]
    assert eq < 1e-6
    second = svc.predict(plate_dict())
    assert second["label"]["status"] == "duplicate"
    assert second["case_id"] == first["case_id"]


def test_surrogate_path_reports_provenance_and_field(tmp_path) -> None:
    fake = FakeEnsemble(spread=0.001)
    svc = make_service(tmp_path, fake)
    out = svc.predict(plate_dict(), include_field=True)
    assert out["source"] == "surrogate"
    assert out["fallback"] == {"used": False, "reason": None}
    assert out["model"]["model_id"] == "physix-unet5-test"
    assert out["summary"]["hotspot_basis"] == "raster"
    assert out["uncertainty"]["disagreement"] <= out["uncertainty"]["threshold"]
    assert out["uncertainty"]["domain"]["in_domain"] is True
    assert set(out["timing"]["stages"]) == {"encode_ms", "inference_ms", "postprocess_ms"}
    field = decode(out["field"])
    assert field.shape == (5, ROWS, COLS)
    assert out["field"]["components"][-1] == "von_mises_std"
    case = case_from_dict(plate_dict())
    assert np.all(field[:, ~solid_mask(case)] == 0)
    assert case.case_id() == out["case_id"]
    sf = out["summary"]["safety_factor"]
    assert sf == pytest.approx(250e6 / out["summary"]["hotspot"]["von_mises"])


def test_high_disagreement_is_a_deterministic_fallback(tmp_path) -> None:
    svc = make_service(tmp_path, FakeEnsemble(spread=0.2))
    a = svc.predict(plate_dict())
    b = svc.predict(plate_dict())
    assert a["source"] == b["source"] == "fem_fallback"
    assert a["fallback"]["reason"] == "high_disagreement"
    assert a["uncertainty"]["disagreement"] == b["uncertainty"]["disagreement"]
    assert a["summary"]["hotspot"] == b["summary"]["hotspot"]


def test_out_of_domain_and_forced_fem(tmp_path) -> None:
    fake = FakeEnsemble(spread=0.0)
    svc = make_service(tmp_path, fake)
    case = plate_dict()
    case["material"] = {"name": "custom", "young": 1e9, "poisson": 0.45}
    out = svc.predict(case)
    assert out["source"] == "fem_fallback"
    assert out["fallback"]["reason"] == "out_of_domain"
    assert out["uncertainty"]["domain"]["in_domain"] is False
    assert out["summary"]["safety_factor"] is None  # no yield strength for custom material
    calls = fake.calls
    forced = svc.predict(plate_dict(), force_fem=True)
    assert forced["source"] == "fem" and forced["fallback"]["used"] is False
    assert "label" not in forced
    assert fake.calls == calls  # forced FEM never runs the surrogate


def test_solver_failure_is_reported(tmp_path, monkeypatch) -> None:
    def boom(*_a: Any, **_k: Any):
        raise RuntimeError("mesh generation failed")

    monkeypatch.setattr(service_module, "solve_unit", boom)
    svc = make_service(tmp_path)
    out = svc.predict(plate_dict())
    assert out["error"] == "solver_failed"
    assert out["fallback_reason"] == "model_unavailable"
    assert "mesh generation failed" in out["message"]


def test_verify_reports_discrepancy_and_rejects_mismatched_prediction(tmp_path) -> None:
    svc = make_service(tmp_path, FakeEnsemble(spread=0.001))
    pred = svc.predict(plate_dict())
    v = svc.verify(plate_dict(), prediction=pred, include_field=True)
    d = v["discrepancy"]
    assert v["source"] == "fem"
    assert d["prediction_hotspot_basis"] == "raster"
    assert d["prediction_hotspot_error"] >= 0
    assert d["surrogate"]["speedup"] > 0
    assert {"component_rel_l2", "von_mises_rel_l2"} <= set(d["surrogate"])
    assert decode(v["field"]).shape == (4, ROWS, COLS)
    mismatch = svc.verify(bracket_dict(), prediction=pred)
    assert mismatch["error"] == "case_mismatch"


def test_mesh_payload_shapes(tmp_path) -> None:
    svc = make_service(tmp_path)
    out = svc.predict(plate_dict(), force_fem=True, include_mesh=True)
    mesh = out["mesh"]
    pts = np.frombuffer(base64.b64decode(mesh["points"]), dtype="<f4").reshape(-1, 2)
    tri = np.frombuffer(base64.b64decode(mesh["triangles"]), dtype="<i4").reshape(-1, 3)
    vm = np.frombuffer(base64.b64decode(mesh["von_mises"]), dtype="<f4")
    assert len(pts) == mesh["n_nodes"] == len(vm)
    assert len(tri) == mesh["n_triangles"] and tri.max() < len(pts)


@pytest.mark.parametrize(
    ("variables", "field"),
    [
        ([], "variables"),
        ([{"path": "material.young", "min": 1, "max": 2}], "variables[0].path"),
        ([{"path": "geometry.holes[3].x", "min": 0.05, "max": 0.1}], "variables[0].path"),
        ([{"path": "geometry.web_width", "min": 0.01, "max": 0.02}], "variables[0].path"),
        ([{"path": "geometry.holes[0].x", "min": 0.2, "max": 0.1}], "variables[0]"),
    ],
)
def test_optimize_rejects_invalid_variables(tmp_path, variables, field) -> None:
    svc = make_service(tmp_path)
    out = svc.optimize({"case": plate_dict(), "variables": variables})
    assert out["error"] == "invalid_request"
    assert out["field"] == field


def test_optimize_request_parsing() -> None:
    case, opts, variables = parse_request(
        {
            "case": plate_dict(),
            "variables": [{"path": "geometry.holes[0].radius", "min": 0.008, "max": 0.016}],
            "constraints": {"min_safety_factor": 2.0},
            "objective": "min_volume",
        }
    )
    assert variables[0]["baseline"] == pytest.approx(0.012)
    assert opts["objective"] == "min_volume" and opts["budget"] == 64
    with pytest.raises(ValueError):
        parse_request({"case": plate_dict(), "variables": variables[:1], "objective": "min_volume"})


def test_optimize_respects_bounds_constraints_and_verifies(tmp_path) -> None:
    svc = make_service(tmp_path, FakeEnsemble(spread=0.001))
    request = {
        "case": plate_dict(),
        "variables": [{"path": "geometry.holes[0].radius", "min": 0.006, "max": 0.016}],
        "objective": "min_volume",
        "constraints": {"max_von_mises": 40e6},
        "budget": 12,
        "seed": 3,
    }
    out = svc.optimize(request)
    assert "error" not in out, out
    sel = out["selected"]
    r = sel["variables"]["geometry.holes[0].radius"]
    assert 0.006 <= r <= 0.016
    assert out["baseline"]["fem"]["ok"] and sel["fem"]["ok"]
    assert out["search"]["evaluations"] <= 12
    if out["verified_improvement"]:
        assert sel["fem"]["feasible"]
        assert sel["fem"]["hotspot_von_mises"] <= 40e6
        assert out["improvement"]["relative_change"] < 0
    again = svc.optimize(request)
    assert again["selected"]["variables"] == sel["variables"]  # seeded and deterministic
