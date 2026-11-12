"""Evaluate an ONNX ensemble against solver labels on matched cases.

Every metric compares the ensemble mean with the scikit-fem field for the identical case,
sampled on the same raster with the same solid mask and units, under the case's own load.

Hotspot metric: maximum von Mises over solid pixels outside a ``0.05 x width`` band at the
support edge, where the clamped corners are singular. ``hotspot_error`` is the relative
error of the surrogate hotspot against the solver's raster hotspot. The solver's raster
hotspot is itself sampled at pixel centres; its ratio to the mesh hotspot (``raster_bias``)
is reported separately so model error and grid resolution are never mixed.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from data.dataset import Dataset
from data.domain import check_domain
from data.raster import combine_targets, raster_hotspot, raster_von_mises
from model.ensemble import ensemble_statistics, field_errors
from model.runtime import OnnxEnsemble


def evaluate_rows(
    ens: OnnxEnsemble, ds: Dataset, rows: np.ndarray, batch: int = 32
) -> list[dict[str, Any]]:
    feats_all = ds.features()
    out: list[dict[str, Any]] = []
    for k in range(0, len(rows), batch):
        chunk = np.sort(rows[k : k + batch])
        members = ens.run(np.asarray(feats_all[chunk]))  # (K, B, 6, R, C)
        for b, row in enumerate(chunk):
            case = ds.case(int(row))
            mask = ds.masks[row]
            res = ensemble_statistics(members[:, b], mask, case)
            ref = combine_targets(np.asarray(ds.targets[row], dtype=np.float64), case.traction())
            ref_hot = raster_hotspot(raster_von_mises(ref), mask, case)
            w = case.geometry.width
            fem_mesh = ds.records[row]["fem_hotspot"]["von_mises"]
            out.append(
                {
                    "row": int(row),
                    "case_id": ds.records[row]["case_id"],
                    "family": case.family,
                    "holes": len(case.geometry.holes),
                    "in_domain": check_domain(case).in_domain,
                    "disagreement": res.disagreement,
                    "field_spread": res.field_spread,
                    "hotspot_error": abs(res.hotspot["von_mises"] - ref_hot["von_mises"])
                    / max(ref_hot["von_mises"], 1e-30),
                    "hotspot_location_error_rel": float(
                        np.hypot(res.hotspot["x"] - ref_hot["x"], res.hotspot["y"] - ref_hot["y"])
                        / w
                    ),
                    "raster_bias": ref_hot["von_mises"] / max(fem_mesh, 1e-30),
                    **field_errors(res.mean, ref, mask),
                }
            )
    return out


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"cases": 0}

    def stats(key: str) -> dict[str, float]:
        v = np.array([r[key] for r in rows], dtype=float)
        return {
            "mean": float(v.mean()),
            "median": float(np.median(v)),
            "p90": float(np.quantile(v, 0.9)),
            "max": float(v.max()),
        }

    summary: dict[str, Any] = {"cases": len(rows)}
    for key in (
        "component_rel_l2",
        "von_mises_rel_l2",
        "hotspot_error",
        "hotspot_location_error_rel",
        "disagreement",
        "raster_bias",
    ):
        summary[key] = stats(key)
    for fam in ("plate", "bracket"):
        sub = [r for r in rows if r["family"] == fam]
        if sub:
            summary[f"{fam}_cases"] = len(sub)
            summary[f"{fam}_hotspot_error_median"] = float(
                np.median([r["hotspot_error"] for r in sub])
            )
            summary[f"{fam}_von_mises_rel_l2_median"] = float(
                np.median([r["von_mises_rel_l2"] for r in sub])
            )
    return summary


def time_inference(ens: OnnxEnsemble, ds: Dataset, row: int, repeats: int = 20) -> dict[str, Any]:
    """Warm single-case latency of encode + 5-member inference + statistics (server side)."""
    case = ds.case(row)
    samples = []
    for _ in range(repeats):
        t0 = time.perf_counter()
        ens.predict(case)
        samples.append(1e3 * (time.perf_counter() - t0))
    return {
        "warm_median_ms": float(np.median(samples)),
        "warm_p90_ms": float(np.quantile(samples, 0.9)),
        "repeats": repeats,
        "boundary": "encode features + 5 ONNX members + ensemble statistics, batch 1, CPU",
    }
