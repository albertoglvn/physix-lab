"""Generate a solver-labelled, versioned dataset (``make gen-data``).

Usage::

    python -m scripts.run_feature data.generate --groups 300 --variants 4 --workers 12

Every case is solved with the scikit-fem reference solver for unit ``x`` and ``y``
tractions, rasterised onto the ``physix.raster/1`` grid and stored with its solid mask.
Related designs (a base outline and its jittered variants) share a group, and groups are
assigned to ``train``, ``calibration`` or ``test`` by a hash of the group identity, so a
design never leaks across splits. A separate ``shifted`` slice holds plates with holes
larger than the training range for out-of-domain evaluation.

Outputs in ``--out``: ``targets.npy`` (N, 6, 64, 128) float32, ``masks.npy`` (N, 64, 128)
bool, ``cases.jsonl`` (one record per row) and ``manifest.json``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np

from data.domain import (
    DOMAIN,
    assign_split,
    group_id,
    jitter_variant,
    sample_base,
    sample_shifted_plate,
)
from data.raster import (
    COLS,
    FEATURE_CHANNELS,
    PROXIMITY_LENGTH_REL,
    RASTER_SCHEMA,
    ROWS,
    SDF_SCALE,
    TARGET_CHANNELS,
    rasterize_unit_solution,
)

DATASET_SCHEMA = "physix.dataset/1"
DEFAULT_OUT = Path("data/generated/physix-ds-v1")
SPLIT_FRACTIONS = {"train": 0.70, "calibration": 0.15, "test": 0.15}


def plan_cases(
    seed: int, groups: int, variants: int, shifted: int, bracket_share: float = 0.4
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Deterministically sample the list of case records to solve."""
    rng = np.random.default_rng(seed)
    records: list[dict[str, Any]] = []
    rejected = {"base": 0, "variant": 0, "shifted": 0}
    n_bracket = int(round(groups * bracket_share))
    families = ["plate"] * (groups - n_bracket) + ["bracket"] * n_bracket
    for index, family in enumerate(families):
        base = None
        while base is None:
            base = sample_base(rng, family)
            if base is None:
                rejected["base"] += 1
        group = group_id(seed, family, index)
        split = assign_split(group, SPLIT_FRACTIONS)
        designs = [base]
        attempts = 0
        while len(designs) < variants and attempts < 20 * variants:
            attempts += 1
            variant = jitter_variant(rng, base)
            if variant is None:
                rejected["variant"] += 1
                continue
            designs.append(variant)
        for k, design in enumerate(designs):
            records.append({"case": design, "group": group, "split": split, "variant": k})
    for index in range(shifted):
        design = sample_shifted_plate(rng)
        if design is None:
            rejected["shifted"] += 1
            continue
        group = group_id(seed, "shifted", index)
        records.append({"case": design, "group": group, "split": "shifted", "variant": 0})
    return records, rejected


def _solve_record(args: tuple[int, dict[str, Any], str]) -> dict[str, Any]:
    """Worker: solve one case and rasterise the unit fields."""
    index, case_data, preset = args
    from physics.case import case_from_dict
    from physics.solver import solve_unit

    try:
        case = case_from_dict(case_data)
        unit = solve_unit(case, preset)
        targets, mask = rasterize_unit_solution(unit)
        sol = unit.combine()
        return {
            "index": index,
            "ok": True,
            "targets": targets,
            "mask": mask,
            "case_id": case.case_id(),
            "fem_hotspot": sol.hotspot(),
            "mesh": {"nodes": unit.mesh.n_nodes, "elements": len(unit.mesh.triangles)},
            "timing_ms": unit.timing.to_dict(),
        }
    except Exception as exc:  # recorded in the manifest, never silently dropped
        return {"index": index, "ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _pilot_convergence(records: list[dict[str, Any]], n: int, preset: str) -> list[dict[str, Any]]:
    """Mesh-refinement check on a deterministic subset, tightest clearances first."""
    from physics.case import case_from_dict
    from physics.convergence import check_convergence
    from physics.geometry import distance_to_outer_boundary
    from physics.mesh import MESH_PRESETS

    def clearance(rec: dict[str, Any]) -> float:
        case = case_from_dict(rec["case"])
        holes = case.geometry.holes
        if not holes:
            return float("inf")
        xs = np.array([h.x for h in holes])
        ys = np.array([h.y for h in holes])
        lig = distance_to_outer_boundary(case, xs, ys) - np.array([h.radius for h in holes])
        return float(lig.min() / case.geometry.width)

    pool = [r for r in records if r["split"] != "shifted"]
    pool.sort(key=clearance)
    chosen = pool[: n // 2] + pool[n // 2 :: max(1, len(pool) // max(1, n - n // 2))][: n - n // 2]
    out = []
    for rec in chosen:
        case = case_from_dict(rec["case"])
        report = check_convergence(case, MESH_PRESETS[preset])
        out.append({"case_id": case.case_id(), "family": case.family, **report.to_dict()})
    return out


def generate(
    out: Path,
    seed: int = 20261112,
    groups: int = 300,
    variants: int = 4,
    shifted: int = 60,
    workers: int | None = None,
    preset: str = "reference",
    pilot: int = 8,
) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    records, rejected = plan_cases(seed, groups, variants, shifted)
    n = len(records)
    workers = workers or max(1, (os.cpu_count() or 2) - 2)
    print(f"[gen-data] {n} cases, {workers} workers, preset={preset}", file=sys.stderr)

    targets = np.lib.format.open_memmap(
        out / "targets.npy",
        mode="w+",
        dtype=np.float32,
        shape=(n, len(TARGET_CHANNELS), ROWS, COLS),
    )
    masks = np.zeros((n, ROWS, COLS), dtype=bool)
    results: list[dict[str, Any] | None] = [None] * n
    jobs = [(i, rec["case"], preset) for i, rec in enumerate(records)]
    # One BLAS thread per worker process; the parallelism is across cases.
    for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ[var] = "1"
    done = 0
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for res in ex.map(_solve_record, jobs, chunksize=4):
            i = res["index"]
            if res["ok"]:
                targets[i] = res.pop("targets")
                masks[i] = res.pop("mask")
            results[i] = res
            done += 1
            if done % 100 == 0 or done == n:
                print(f"[gen-data] {done}/{n} ({time.time() - started:.0f} s)", file=sys.stderr)
    targets.flush()

    failed = [i for i, r in enumerate(results) if r is None or not r["ok"]]
    with (out / "cases.jsonl").open("w", encoding="utf-8") as fh:
        for i, rec in enumerate(records):
            res = results[i] or {"ok": False, "error": "missing"}
            row = {
                "row": i,
                "group": rec["group"],
                "split": rec["split"] if res["ok"] else "failed",
                "variant": rec["variant"],
                "case": rec["case"],
                **{k: v for k, v in res.items() if k not in ("index",)},
            }
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    np.save(out / "masks.npy", masks)

    print("[gen-data] pilot convergence checks", file=sys.stderr)
    pilot_reports = _pilot_convergence(records, pilot, preset) if pilot else []

    from physics.mesh import MESH_PRESETS
    from physics.solver import SOLVER_NAME, SOLVER_VERSION

    split_counts: dict[str, int] = {}
    for i, rec in enumerate(records):
        key = "failed" if i in failed else rec["split"]
        split_counts[key] = split_counts.get(key, 0) + 1
    config = {
        "seed": seed,
        "groups": groups,
        "variants": variants,
        "shifted": shifted,
        "preset": preset,
        "split_fractions": SPLIT_FRACTIONS,
        "domain": DOMAIN,
    }
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    timings = [r["timing_ms"]["total_ms"] for r in results if r and r["ok"]]
    manifest = {
        "schema": DATASET_SCHEMA,
        "dataset_id": f"physix-ds-{config_hash}",
        "created_unix": int(time.time()),
        "config": config,
        "raster": {
            "schema": RASTER_SCHEMA,
            "rows": ROWS,
            "cols": COLS,
            "row_order": "top_to_bottom",
            "pixel_size": "width / cols (m)",
            "feature_channels": list(FEATURE_CHANNELS),
            "target_channels": list(TARGET_CHANNELS),
            "target_units": "Pa per Pa of applied traction",
            "sdf_scale": SDF_SCALE,
            "proximity_length_rel": PROXIMITY_LENGTH_REL,
        },
        "solver": {
            "name": SOLVER_NAME,
            "version": SOLVER_VERSION,
            "mesh_preset": preset,
            "mesh_settings": asdict(MESH_PRESETS[preset]),
        },
        "counts": {"cases": n, "failed": len(failed), "rejected_samples": rejected, **split_counts},
        "pilot_convergence": pilot_reports,
        "solve_time_ms": {
            "median": float(np.median(timings)) if timings else None,
            "p95": float(np.percentile(timings, 95)) if timings else None,
            "workers": workers,
        },
        "host": {"platform": platform.platform(), "cpu_count": os.cpu_count()},
        "generation_seconds": round(time.time() - started, 1),
        "files": {
            "targets": "targets.npy",
            "masks": "masks.npy",
            "cases": "cases.jsonl",
        },
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[gen-data] wrote {out} ({manifest['dataset_id']})", file=sys.stderr)
    return manifest


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--seed", type=int, default=20261112)
    p.add_argument("--groups", type=int, default=300)
    p.add_argument("--variants", type=int, default=4)
    p.add_argument("--shifted", type=int, default=60)
    p.add_argument("--workers", type=int, default=None)
    p.add_argument("--preset", default="reference")
    p.add_argument("--pilot", type=int, default=8, help="cases for the mesh-refinement check")
    a = p.parse_args(argv)
    generate(a.out, a.seed, a.groups, a.variants, a.shifted, a.workers, a.preset, a.pilot)


if __name__ == "__main__":
    main()
