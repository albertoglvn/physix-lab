"""Ensemble statistics shared by evaluation, calibration and the service.

All arrays use the ``physix.raster/1`` layout. ``members`` has shape ``(K, 6, R, C)`` in
Pa per Pa of traction; the physical field for a traction ``(tx, ty)`` is a linear
combination, so disagreement is always measured under the request's actual load.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from data.raster import combine_targets, raster_hotspot, raster_von_mises
from physics.case import Case


@dataclass
class EnsembleResult:
    mean: np.ndarray  # (3, R, C) Pa: sxx, syy, txy
    von_mises: np.ndarray  # (R, C) Pa, von Mises of the mean field
    member_hotspots: np.ndarray  # (K,) Pa
    hotspot: dict[str, float]
    disagreement: float  # std(member hotspot) / mean hotspot
    field_spread: float  # masked RMS of member von Mises std over RMS of mean von Mises
    std_von_mises: np.ndarray  # (R, C) Pa, member standard deviation of von Mises

    def to_summary(self) -> dict[str, Any]:
        return {
            "hotspot": self.hotspot,
            "disagreement": self.disagreement,
            "field_spread": self.field_spread,
            "member_hotspots": [float(v) for v in self.member_hotspots],
        }


def ensemble_statistics(members: np.ndarray, mask: np.ndarray, case: Case) -> EnsembleResult:
    traction = case.traction()
    phys = np.stack([combine_targets(m, traction) for m in members])  # (K, 3, R, C)
    member_vm = raster_von_mises(np.moveaxis(phys, 1, 0))  # (K, R, C)
    mean = phys.mean(axis=0)
    vm = raster_von_mises(mean)
    hotspot = raster_hotspot(vm, mask, case)
    member_hot = np.array([raster_hotspot(v, mask, case)["von_mises"] for v in member_vm])
    scale = max(float(member_hot.mean()), 1e-30)
    std_vm = member_vm.std(axis=0)
    rms_mean = float(np.sqrt(np.mean(vm[mask] ** 2))) if mask.any() else 0.0
    spread = (
        float(np.sqrt(np.mean(std_vm[mask] ** 2)) / max(rms_mean, 1e-30)) if mask.any() else 0.0
    )
    return EnsembleResult(
        mean=mean,
        von_mises=vm,
        member_hotspots=member_hot,
        hotspot=hotspot,
        disagreement=float(member_hot.std() / scale),
        field_spread=spread,
        std_von_mises=std_vm,
    )


def field_errors(pred: np.ndarray, ref: np.ndarray, mask: np.ndarray) -> dict[str, float]:
    """Masked relative errors of a physical field ``(3, R, C)`` against the reference."""
    m = mask.astype(bool)
    diff = (pred - ref)[:, m]
    ref_m = ref[:, m]
    rel_l2 = float(np.linalg.norm(diff) / max(np.linalg.norm(ref_m), 1e-30))
    vm_p = raster_von_mises(pred)[m]
    vm_r = raster_von_mises(ref)[m]
    vm_rel_l2 = float(np.linalg.norm(vm_p - vm_r) / max(np.linalg.norm(vm_r), 1e-30))
    vm_mae_rel = float(np.mean(np.abs(vm_p - vm_r)) / max(float(np.max(vm_r)), 1e-30))
    return {
        "component_rel_l2": rel_l2,
        "von_mises_rel_l2": vm_rel_l2,
        "von_mises_mae_rel_peak": vm_mae_rel,
    }
