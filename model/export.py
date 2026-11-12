"""Export, calibrate and evaluate the ensemble as a versioned bundle (``make export``).

Usage::

    python -m scripts.run_feature model.export --run model/checkpoints/<run_id>

Steps: export each checkpoint to ONNX with normalization and masking baked in, check
PyTorch/ONNX parity on the shared encoding fixture, calibrate the fallback threshold on the
calibration split, evaluate the frozen test split and the shifted slice against the solver
labels, and write ``model/exports/<model_id>/manifest.json``. With ``--publish`` the bundle
is copied to ``web/public/models`` for the browser.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

from data.dataset import load_dataset
from data.domain import DOMAIN
from data.fixtures import fixture_cases
from data.raster import (
    COLS,
    FEATURE_CHANNELS,
    RASTER_SCHEMA,
    ROWS,
    TARGET_CHANNELS,
    encode_features,
)
from model.calibrate import calibrate_threshold, coverage_report
from model.evaluate import evaluate_rows, summarize, time_inference
from model.runtime import MODEL_SCHEMA, OnnxEnsemble
from physics.case import case_from_dict

DEFAULT_EXPORTS = Path("model/exports")
WEB_MODELS = Path("web/public/models")
OPSET = 17
PARITY_TOLERANCE = 1e-4  # relative to the output scale


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_member(path: Path):
    import torch

    from model.unet import PhysicalModel, UNet

    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    norm = ckpt["normalization"]
    model = PhysicalModel(
        UNet(**ckpt["model_config"]), torch.tensor(norm["mean"]), torch.tensor(norm["std"])
    )
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, ckpt


def export_member(model, out: Path) -> None:
    import torch

    dummy = torch.zeros(1, len(FEATURE_CHANNELS), ROWS, COLS)
    torch.onnx.export(
        model,
        (dummy,),
        str(out),
        input_names=["features"],
        output_names=["stress"],
        dynamic_axes={"features": {0: "batch"}, "stress": {0: "batch"}},
        opset_version=OPSET,
        dynamo=False,
    )


def parity_check(models, bundle: Path) -> dict[str, Any]:
    """Maximum ONNX vs PyTorch difference on the fixture cases, relative to output scale."""
    import onnxruntime as ort
    import torch

    feats = np.stack([encode_features(case_from_dict(c)) for c in fixture_cases().values()])
    worst = 0.0
    for k, model in enumerate(models):
        with torch.no_grad():
            ref = model(torch.from_numpy(feats)).numpy()
        sess = ort.InferenceSession(
            str(bundle / f"member_{k}.onnx"), providers=["CPUExecutionProvider"]
        )
        got = sess.run(None, {"features": feats})[0]
        worst = max(worst, float(np.abs(got - ref).max() / max(np.abs(ref).max(), 1e-12)))
    if worst > PARITY_TOLERANCE:
        raise RuntimeError(f"ONNX parity {worst:.2e} exceeds {PARITY_TOLERANCE:.0e}")
    return {"max_rel_diff": worst, "tolerance": PARITY_TOLERANCE, "cases": list(fixture_cases())}


def export(run_dir: Path, exports: Path, publish: bool, data: Path | None = None) -> dict[str, Any]:
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    ds = load_dataset(data or Path(run["dataset_path"]))
    if ds.dataset_id != run["dataset_id"]:
        raise SystemExit("dataset does not match the training run")
    staging = exports / f".staging-{run['run_id']}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    members_meta = []
    models = []
    for m in run["members"]:
        ckpt_path = run_dir / m["file"]
        model, ckpt = load_member(ckpt_path)
        models.append(model)
        onnx_path = staging / f"member_{m['member']}.onnx"
        export_member(model, onnx_path)
        members_meta.append(
            {
                "member": m["member"],
                "seed": m["seed"],
                "file": onnx_path.name,
                "sha256": _sha256(onnx_path),
                "bytes": onnx_path.stat().st_size,
                "checkpoint": ckpt_path.name,
                "checkpoint_sha256": _sha256(ckpt_path),
                "best_epoch": ckpt["best_epoch"],
                "parameters": ckpt["parameters"],
            }
        )
    parity = parity_check(models, staging)
    model_id = (
        "physix-unet5-"
        + hashlib.sha256("".join(m["sha256"] for m in members_meta).encode()).hexdigest()[:10]
    )
    print(f"[export] {model_id}: parity {parity['max_rel_diff']:.1e}", file=sys.stderr)

    # Provisional manifest so the runtime can load the staging bundle for evaluation.
    manifest: dict[str, Any] = {
        "schema": MODEL_SCHEMA,
        "model_id": model_id,
        "members": members_meta,
        "fallback_policy": {"threshold": float("inf")},
    }
    (staging / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    ens = OnnxEnsemble(staging, threads=8)

    print("[export] evaluating calibration, test and shifted splits", file=sys.stderr)
    per_split = {
        s: evaluate_rows(ens, ds, ds.indices(s)) for s in ("calibration", "test", "shifted")
    }
    cal = [r for r in per_split["calibration"] if r["in_domain"]]
    policy = calibrate_threshold(
        np.array([r["disagreement"] for r in cal]), np.array([r["hotspot_error"] for r in cal])
    )
    q = policy["target"]["hotspot_error_quantile"]
    test = [r for r in per_split["test"] if r["in_domain"]]
    policy["test"] = coverage_report(
        np.array([r["disagreement"] for r in test]),
        np.array([r["hotspot_error"] for r in test]),
        policy["threshold"],
        q,
    )
    shifted = per_split["shifted"]
    evaluation = {
        "reference": "scikit-fem labels for identical cases on the dataset mesh preset",
        "dataset_id": ds.dataset_id,
        "splits": {s: summarize(rows) for s, rows in per_split.items()},
        "shifted_routing": {
            "cases": len(shifted),
            "out_of_domain": int(sum(not r["in_domain"] for r in shifted)),
            "note": "out-of-domain cases are always routed to the solver by the domain check",
        },
        "timing": time_inference(ens, ds, int(ds.indices("test")[0])),
        "host": {"platform": platform.platform(), "processor": platform.processor()},
        "metrics": {
            "hotspot": "max von Mises over solid pixels outside 0.05 x width of the support edge",
            "hotspot_error": "|surrogate - solver| / solver, both raster hotspots",
            "component_rel_l2": "masked relative L2 of (sxx, syy, txy)",
            "von_mises_rel_l2": "masked relative L2 of von Mises",
            "raster_bias": "solver raster hotspot / solver mesh hotspot",
        },
    }
    manifest = {
        "schema": MODEL_SCHEMA,
        "model_id": model_id,
        "created_unix": int(time.time()),
        "run_id": run["run_id"],
        "dataset_id": ds.dataset_id,
        "architecture": {
            "name": "UNet",
            **run["model_config"],
            "parameters": members_meta[0]["parameters"],
        },
        "training": {k: run[k] for k in ("hyperparameters", "loss", "fit_rows", "val_rows")},
        "raster": {
            "schema": RASTER_SCHEMA,
            "rows": ROWS,
            "cols": COLS,
            "feature_channels": list(FEATURE_CHANNELS),
            "target_channels": list(TARGET_CHANNELS),
            "row_order": "top_to_bottom",
        },
        "io": {
            "input": {"name": "features", "shape": ["batch", len(FEATURE_CHANNELS), ROWS, COLS]},
            "output": {
                "name": "stress",
                "shape": ["batch", len(TARGET_CHANNELS), ROWS, COLS],
                "units": "Pa per Pa of applied traction",
            },
            "normalization": "baked into the graph",
            "opset": OPSET,
        },
        "normalization": run["normalization"],
        "domain": DOMAIN,
        "members": members_meta,
        "parity": parity,
        "fallback_policy": policy,
        "evaluation": evaluation,
    }
    final = exports / model_id
    if final.exists():
        shutil.rmtree(final)
    (staging / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (staging / "evaluation_cases.json").write_text(
        json.dumps(per_split, indent=1), encoding="utf-8"
    )
    del ens
    staging.rename(final)
    (exports / "LATEST").write_text(model_id, encoding="utf-8")
    if publish:
        publish_bundle(final, WEB_MODELS)
    print(f"[export] wrote {final}", file=sys.stderr)
    return manifest


def publish_bundle(bundle: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("member_*.onnx"):
        old.unlink()
    for f in bundle.glob("member_*.onnx"):
        shutil.copy2(f, target / f.name)
    shutil.copy2(bundle / "manifest.json", target / "manifest.json")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Export and evaluate the Physix ensemble")
    p.add_argument("--run", type=Path, default=None, help="checkpoint run directory")
    p.add_argument("--checkpoints", type=Path, default=Path("model/checkpoints"))
    p.add_argument("--out", type=Path, default=DEFAULT_EXPORTS)
    p.add_argument("--data", type=Path, default=None)
    p.add_argument("--publish", action="store_true", help="copy the bundle to web/public/models")
    a = p.parse_args(argv)
    run_dir = (
        a.run or a.checkpoints / (a.checkpoints / "LATEST").read_text(encoding="utf-8").strip()
    )
    export(run_dir, a.out, a.publish, a.data)


if __name__ == "__main__":
    main()
