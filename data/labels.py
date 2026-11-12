"""Active-learning label store for solver results produced by FEM fallback.

Each successful fallback solve is stored once, keyed by ``case_id``, as
``<store>/<case_id>.npz`` (unit-traction targets and mask) plus ``<case_id>.json``
(case, provenance, solver settings). Re-submitting the same case is a no-op, so intake is
idempotent. Cases that belong to a frozen test split are never offered for retraining.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np

from data.raster import COLS, RASTER_SCHEMA, ROWS, TARGET_CHANNELS
from physics.case import Case, case_from_dict

LABEL_SCHEMA = "physix.label/1"
DEFAULT_STORE = Path("data/generated/labels")


def label_path(store: Path, case_id: str) -> Path:
    return store / f"{case_id}.json"


def ingest_label(
    store: str | Path,
    case: Case,
    targets: np.ndarray,
    mask: np.ndarray,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    """Persist a solver label once. Returns ``{"status": "added"|"duplicate", ...}``."""
    store = Path(store)
    targets = np.asarray(targets, dtype=np.float32)
    mask = np.asarray(mask, dtype=bool)
    if targets.shape != (len(TARGET_CHANNELS), ROWS, COLS) or mask.shape != (ROWS, COLS):
        raise ValueError("label arrays do not match the physix.raster/1 grid")
    if not np.all(np.isfinite(targets)):
        raise ValueError("label contains non-finite values")
    case_id = case.case_id()
    meta_path = label_path(store, case_id)
    if meta_path.is_file():
        return {"status": "duplicate", "case_id": case_id}
    store.mkdir(parents=True, exist_ok=True)
    # Write arrays first and the JSON record last, each atomically, so a crash never leaves
    # a record that points at missing arrays.
    tmp = store / f".{case_id}.{os.getpid()}.npz"
    np.savez_compressed(tmp, targets=targets, mask=mask)
    os.replace(tmp, store / f"{case_id}.npz")
    record = {
        "schema": LABEL_SCHEMA,
        "case_id": case_id,
        "case": case.to_dict(),
        "raster": RASTER_SCHEMA,
        "created_unix": int(time.time()),
        "provenance": provenance,
    }
    tmp_json = store / f".{case_id}.{os.getpid()}.json"
    tmp_json.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp_json, meta_path)
    return {"status": "added", "case_id": case_id}


def list_labels(store: str | Path) -> list[dict[str, Any]]:
    store = Path(store)
    if not store.is_dir():
        return []
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(store.glob("case_*.json"))]


def load_label(store: str | Path, case_id: str) -> tuple[Case, np.ndarray, np.ndarray]:
    store = Path(store)
    record = json.loads(label_path(store, case_id).read_text(encoding="utf-8"))
    arrays = np.load(store / f"{case_id}.npz")
    return case_from_dict(record["case"]), arrays["targets"], arrays["mask"]


def retraining_candidates(store: str | Path, frozen_case_ids: Iterable[str]) -> list[str]:
    """Label ids eligible for retraining: everything except frozen evaluation cases."""
    frozen = set(frozen_case_ids)
    return [r["case_id"] for r in list_labels(store) if r["case_id"] not in frozen]
