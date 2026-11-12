"""Fallback policy calibration: pick the disagreement threshold on the calibration split.

The policy accepts a surrogate prediction when the case is inside the training domain and
the ensemble disagreement is at most ``threshold``; anything else goes to the solver. The
threshold is the largest value whose accepted calibration cases keep the chosen quantile
of the hotspot error within the target. Coverage and error are then re-measured on the
untouched test split.
"""

from __future__ import annotations

from typing import Any

import numpy as np

POLICY_SCHEMA = "physix.fallback/1"
DEFAULT_TARGET = 0.10  # 10 % hotspot error
DEFAULT_QUANTILE = 0.90


def calibrate_threshold(
    disagreement: np.ndarray,
    hotspot_error: np.ndarray,
    target: float = DEFAULT_TARGET,
    quantile: float = DEFAULT_QUANTILE,
    min_accepted: int = 10,
) -> dict[str, Any]:
    """Return the policy dictionary for the largest admissible threshold."""
    d = np.asarray(disagreement, dtype=float)
    e = np.asarray(hotspot_error, dtype=float)
    if d.shape != e.shape or d.ndim != 1 or len(d) == 0:
        raise ValueError("disagreement and hotspot_error must be equal-length 1-D arrays")
    order = np.argsort(d)
    d_sorted, e_sorted = d[order], e[order]
    best_k = 0
    for k in range(min_accepted, len(d) + 1):
        if np.quantile(e_sorted[:k], quantile) <= target:
            best_k = k
    if best_k == 0:
        threshold = -1.0  # disagreement is non-negative: every case goes to the solver
    elif best_k == len(d):
        threshold = float(d_sorted[-1])
    else:
        # Midpoint between the last accepted and first rejected disagreement.
        threshold = float(0.5 * (d_sorted[best_k - 1] + d_sorted[best_k]))
    return {
        "schema": POLICY_SCHEMA,
        "metric": "relative std of member hotspot von Mises under the request load",
        "threshold": threshold,
        "target": {"hotspot_error_quantile": quantile, "max_hotspot_error": target},
        "calibration": coverage_report(d, e, threshold, quantile),
        "requires_in_domain": True,
    }


def coverage_report(
    disagreement: np.ndarray, hotspot_error: np.ndarray, threshold: float, quantile: float
) -> dict[str, Any]:
    d = np.asarray(disagreement, dtype=float)
    e = np.asarray(hotspot_error, dtype=float)
    accepted = d <= threshold
    n_acc = int(accepted.sum())
    return {
        "cases": int(len(d)),
        "accepted": n_acc,
        "coverage": float(n_acc / len(d)) if len(d) else 0.0,
        "accepted_hotspot_error_quantile": float(np.quantile(e[accepted], quantile))
        if n_acc
        else None,
        "accepted_hotspot_error_median": float(np.median(e[accepted])) if n_acc else None,
        "rejected_hotspot_error_median": float(np.median(e[~accepted])) if n_acc < len(d) else None,
        "all_hotspot_error_quantile": float(np.quantile(e, quantile)),
    }


def decide(policy: dict[str, Any], disagreement: float, in_domain: bool) -> tuple[bool, str | None]:
    """Return ``(use_surrogate, reason)`` for one prediction."""
    if not in_domain and policy.get("requires_in_domain", True):
        return False, "out_of_domain"
    if not np.isfinite(disagreement):
        return False, "non_finite_prediction"
    if disagreement > policy["threshold"]:
        return False, "high_disagreement"
    return True, None
