"""Load a generated dataset with its manifest, case records and split membership."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from data.raster import encode_features
from physics.case import Case, case_from_dict


@dataclass
class Dataset:
    root: Path
    manifest: dict[str, Any]
    records: list[dict[str, Any]]
    targets: np.ndarray  # (N, 6, R, C) float32, memory-mapped
    masks: np.ndarray  # (N, R, C) bool

    @property
    def dataset_id(self) -> str:
        return str(self.manifest["dataset_id"])

    def indices(self, split: str) -> np.ndarray:
        return np.array([r["row"] for r in self.records if r["split"] == split], dtype=np.int64)

    def case(self, row: int) -> Case:
        return case_from_dict(self.records[row]["case"])

    def features(self, rows: np.ndarray | None = None) -> np.ndarray:
        """Encoded features, cached next to the dataset as ``features.npy``."""
        path = self.root / "features.npy"
        if path.is_file():
            feats = np.load(path, mmap_mode="r")
        else:
            feats = np.stack([encode_features(self.case(i)) for i in range(len(self.records))])
            np.save(path, feats)
        return feats if rows is None else np.asarray(feats[rows])


def load_dataset(root: str | Path) -> Dataset:
    root = Path(root)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    with (root / "cases.jsonl").open(encoding="utf-8") as fh:
        records = [json.loads(line) for line in fh if line.strip()]
    targets = np.load(root / manifest["files"]["targets"], mmap_mode="r")
    masks = np.load(root / manifest["files"]["masks"])
    if len(records) != targets.shape[0] or masks.shape[0] != targets.shape[0]:
        raise ValueError("dataset files disagree on the number of cases")
    return Dataset(root, manifest, records, targets, masks)
