"""ONNX Runtime inference for an exported ensemble bundle (``physix.model/1``).

The service uses the exported ONNX members, the same artifacts the browser runs, so the
Python and browser predictions come from identical graphs.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from data.raster import encode_features, solid_mask
from model.ensemble import EnsembleResult, ensemble_statistics
from physics.case import Case

MODEL_SCHEMA = "physix.model/1"


class BundleError(RuntimeError):
    pass


class OnnxEnsemble:
    def __init__(
        self, bundle_dir: str | Path, threads: int = 4, verify_hashes: bool = True
    ) -> None:
        import onnxruntime as ort

        self.root = Path(bundle_dir)
        manifest_path = self.root / "manifest.json"
        if not manifest_path.is_file():
            raise BundleError(f"no model bundle at {self.root}")
        self.manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
        if self.manifest.get("schema") != MODEL_SCHEMA:
            raise BundleError(f"unsupported bundle schema {self.manifest.get('schema')}")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        self.sessions = []
        for member in self.manifest["members"]:
            path = self.root / member["file"]
            data = path.read_bytes()
            if verify_hashes and hashlib.sha256(data).hexdigest() != member["sha256"]:
                raise BundleError(f"hash mismatch for {member['file']}")
            self.sessions.append(
                ort.InferenceSession(data, opts, providers=["CPUExecutionProvider"])
            )

    @property
    def model_id(self) -> str:
        return str(self.manifest["model_id"])

    @property
    def policy(self) -> dict[str, Any]:
        return self.manifest["fallback_policy"]

    def run(self, features: np.ndarray) -> np.ndarray:
        """Member outputs ``(K, B, 6, R, C)`` for features ``(B, 7, R, C)``."""
        x = np.ascontiguousarray(features, dtype=np.float32)
        return np.stack([s.run(None, {"features": x})[0] for s in self.sessions])

    def predict(self, case: Case) -> tuple[EnsembleResult, np.ndarray, dict[str, float]]:
        t0 = time.perf_counter()
        feats = encode_features(case)[None]
        t1 = time.perf_counter()
        members = self.run(feats)[:, 0]
        t2 = time.perf_counter()
        mask = solid_mask(case)
        result = ensemble_statistics(members, mask, case)
        t3 = time.perf_counter()
        timing = {
            "encode_ms": 1e3 * (t1 - t0),
            "inference_ms": 1e3 * (t2 - t1),
            "postprocess_ms": 1e3 * (t3 - t2),
        }
        return result, mask, timing
