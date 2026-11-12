"""Raster grid, feature encoding and solver-field rasterisation (contract ``physix.raster/1``).

Grid
    ``ROWS x COLS = 64 x 128`` square pixels of size ``dx = width / COLS``. The frame covers
    ``x in [0, width]`` and ``y in [0, ROWS * dx] = [0, 0.5 * width]``. Arrays are row-major
    with **row 0 at the top** (maximum ``y``) and column 0 at ``x = 0``. Pixel ``(i, j)`` has
    its centre at ``x = (j + 0.5) dx`` and ``y = (ROWS - i - 0.5) dx``. Parts taller than
    ``0.5 * width`` cannot be encoded and are outside the surrogate domain.

Features (float32, shape ``(7, ROWS, COLS)``), see ``FEATURE_CHANNELS``
    0 ``mask``: 1 where the pixel centre is inside the solid (SDF < 0), else 0.
    1 ``sdf``: ``clip(10 * sdf / width, -1, 1)``.
    2 ``x``: ``x / width``.
    3 ``y``: ``2 * y / width``.
    4 ``support``: ``exp(-d_support / (0.1 * width))`` with ``d_support`` the distance to the
      support edge.
    5 ``load``: ``exp(-d_load / (0.1 * width))`` with ``d_load`` the distance to the load edge.
    6 ``poisson``: ``(nu - 0.3) / 0.1`` (constant).

Targets (float32, shape ``(6, ROWS, COLS)``), see ``TARGET_CHANNELS``
    Dimensionless stress per unit traction: ``(sxx, syy, txy)`` for a unit ``x`` traction
    followed by the same for a unit ``y`` traction. Zero outside the mask. The stress for a
    traction ``(tx, ty)`` is ``tx * T[0:3] + ty * T[3:6]`` in Pa.

``web/src/physics/encoding.ts`` reimplements :func:`encode_features`; both are checked
against ``tests/fixtures/encoding_v1.json``.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from physics.case import Case
from physics.geometry import distance_to_segment, load_segment, signed_distance, support_segment
from physics.solver import UnitSolution, von_mises

RASTER_SCHEMA = "physix.raster/1"
ROWS = 64
COLS = 128
FEATURE_CHANNELS = ("mask", "sdf", "x", "y", "support", "load", "poisson")
TARGET_CHANNELS = ("sxx_x", "syy_x", "txy_x", "sxx_y", "syy_y", "txy_y")
PROXIMITY_LENGTH_REL = 0.1
SDF_SCALE = 10.0


def pixel_size(case: Case) -> float:
    return case.geometry.width / COLS


def frame(case: Case) -> dict[str, Any]:
    """Raster frame description used in API responses and manifests (metres)."""
    dx = pixel_size(case)
    return {
        "schema": RASTER_SCHEMA,
        "rows": ROWS,
        "cols": COLS,
        "dx": dx,
        "x0": 0.0,
        "y0": 0.0,
        "row_order": "top_to_bottom",
    }


def fits_frame(case: Case) -> bool:
    return case.geometry.height <= ROWS * pixel_size(case) + 1e-12


def pixel_centres(case: Case) -> tuple[np.ndarray, np.ndarray]:
    dx = pixel_size(case)
    j = np.arange(COLS)
    i = np.arange(ROWS)
    px = (j[None, :] + 0.5) * dx
    py = (ROWS - i[:, None] - 0.5) * dx
    return np.broadcast_to(px, (ROWS, COLS)), np.broadcast_to(py, (ROWS, COLS))


def encode_features(case: Case) -> np.ndarray:
    """Encode a case into the surrogate's input tensor ``(7, ROWS, COLS)``."""
    w = case.geometry.width
    px, py = pixel_centres(case)
    sdf = signed_distance(case, px, py)
    lam = PROXIMITY_LENGTH_REL * w
    d_sup = distance_to_segment(support_segment(case), px, py)
    d_load = distance_to_segment(load_segment(case), px, py)
    out = np.empty((len(FEATURE_CHANNELS), ROWS, COLS), dtype=np.float32)
    out[0] = sdf < 0
    out[1] = np.clip(SDF_SCALE * sdf / w, -1.0, 1.0)
    out[2] = px / w
    out[3] = 2.0 * py / w
    out[4] = np.exp(-d_sup / lam)
    out[5] = np.exp(-d_load / lam)
    out[6] = (case.material.poisson - 0.3) / 0.1
    return out


def solid_mask(case: Case) -> np.ndarray:
    px, py = pixel_centres(case)
    return signed_distance(case, px, py) < 0


def support_band_mask(case: Case, band_rel: float) -> np.ndarray:
    """Pixels closer than ``band_rel * width`` to the support edge."""
    px, py = pixel_centres(case)
    return distance_to_segment(support_segment(case), px, py) < band_rel * case.geometry.width


def rasterize_unit_solution(unit: UnitSolution) -> tuple[np.ndarray, np.ndarray]:
    """Sample unit-traction solver fields at solid pixel centres.

    Returns ``(targets, mask)`` with targets of shape ``(6, ROWS, COLS)`` in Pa per Pa.
    """
    case = unit.case
    mask = solid_mask(case)
    px, py = pixel_centres(case)
    values = unit.stress.sample(px[mask], py[mask])
    targets = np.zeros((len(TARGET_CHANNELS), ROWS, COLS), dtype=np.float32)
    targets[:, mask] = values.T.astype(np.float32)
    return targets, mask


def combine_targets(targets: np.ndarray, traction: tuple[float, float]) -> np.ndarray:
    """Physical stress ``(3, ...)`` in Pa from unit fields ``(6, ...)`` and a traction."""
    tx, ty = traction
    return tx * targets[0:3] + ty * targets[3:6]


def raster_von_mises(stress: np.ndarray) -> np.ndarray:
    return von_mises(stress[0], stress[1], stress[2])


def raster_hotspot(
    vm: np.ndarray, mask: np.ndarray, case: Case, band_rel: float = 0.05
) -> dict[str, float]:
    """Raster hotspot: max von Mises over solid pixels outside the support band."""
    valid = mask & ~support_band_mask(case, band_rel)
    if not valid.any():
        valid = mask
    masked = np.where(valid, vm, -np.inf)
    i, j = np.unravel_index(int(np.argmax(masked)), masked.shape)
    dx = pixel_size(case)
    return {
        "von_mises": float(vm[i, j]),
        "x": float((j + 0.5) * dx),
        "y": float((ROWS - i - 0.5) * dx),
        "row": int(i),
        "col": int(j),
    }
