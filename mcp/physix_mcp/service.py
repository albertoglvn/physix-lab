"""Physix service layer shared by the MCP server and the local HTTP API.

Every public method takes and returns JSON-compatible dictionaries in SI units. Errors are
returned as ``{"error": <code>, "message": ..., "field": ...}`` dictionaries rather than
raised, so agents and browsers receive the same structured explanation.

Routing for ``predict``:

1. Validate the case (``invalid_case``/``unsupported_case`` errors are final).
2. If a model bundle is loaded, the case is inside the training domain and the ensemble
   disagreement is at or below the calibrated threshold, return the surrogate (``surrogate``).
3. Otherwise solve with scikit-fem (``fem_fallback`` with a reason, or ``fem`` when the
   caller forced the solver) and enqueue the solver label for offline retraining.
"""

from __future__ import annotations

import base64
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from data.domain import DOMAIN, check_domain
from data.labels import DEFAULT_STORE, ingest_label
from data.raster import (
    COLS,
    ROWS,
    combine_targets,
    fits_frame,
    frame,
    raster_hotspot,
    raster_von_mises,
    rasterize_unit_solution,
)
from model.calibrate import decide
from model.ensemble import field_errors
from physics.case import Case, CaseValidationError, case_from_dict
from physics.convergence import STUDY_PRESETS, convergence_study
from physics.examples import bracket_dict, plate_dict
from physics.geometry import solid_area
from physics.materials import MATERIALS, YIELD_STRENGTH
from physics.mesh import MESH_PRESETS
from physics.solver import SOLVER_NAME, SOLVER_VERSION, solve_unit

log = logging.getLogger("physix")

PREDICTION_SCHEMA = "physix.prediction/1"
CONVERGENCE_SCHEMA = "physix.convergence/1"
DEFAULT_EXPORTS = Path("model/exports")


def _b64(array: np.ndarray, dtype: Any = np.float32) -> str:
    return base64.b64encode(
        np.ascontiguousarray(array, dtype=dtype).astype(dtype).tobytes()
    ).decode()


def resolve_bundle(explicit: str | Path | None = None) -> Path | None:
    """Model bundle: explicit path, ``PHYSIX_MODEL_DIR`` or ``model/exports/LATEST``."""
    if explicit:
        return Path(explicit)
    env = os.environ.get("PHYSIX_MODEL_DIR")
    if env:
        return Path(env)
    latest = DEFAULT_EXPORTS / "LATEST"
    if latest.is_file():
        return DEFAULT_EXPORTS / latest.read_text(encoding="utf-8").strip()
    return None


def _error(exc: CaseValidationError) -> dict[str, Any]:
    return exc.to_dict()


def _material_strength(case: Case) -> float | None:
    return YIELD_STRENGTH.get(case.material.name or "")


def _summary(
    case: Case, hotspot: dict[str, float], basis: str, max_von_mises: float
) -> dict[str, Any]:
    sy = _material_strength(case)
    vm = float(hotspot["von_mises"])
    nominal = case.traction_magnitude()
    return {
        "max_von_mises": float(max_von_mises),
        "hotspot": {"von_mises": vm, "x": float(hotspot["x"]), "y": float(hotspot["y"])},
        "hotspot_basis": basis,
        "stress_concentration": vm / nominal if nominal else None,
        "nominal_traction": nominal,
        "applied_force": list(case.resultant_force()),
        "yield_strength": sy,
        "safety_factor": (sy / vm) if (sy and vm > 0) else None,
        "volume": solid_area(case) * case.thickness,
    }


class PhysixService:
    def __init__(
        self,
        bundle_dir: str | Path | None = None,
        label_store: str | Path | None = DEFAULT_STORE,
        fem_preset: str = "reference",
        threads: int = 4,
    ) -> None:
        self.fem_preset = fem_preset
        self.label_store = Path(label_store) if label_store else None
        self.ensemble = None
        self.model_error: str | None = None
        self._lock = threading.Lock()
        path = resolve_bundle(bundle_dir)
        if path is None:
            self.model_error = "no model bundle found (run make export)"
        else:
            try:
                from model.runtime import OnnxEnsemble

                self.ensemble = OnnxEnsemble(path, threads=threads)
                log.info("loaded model bundle %s", self.ensemble.model_id)
            except Exception as exc:  # the service still works with the solver alone
                self.model_error = f"{type(exc).__name__}: {exc}"
                log.warning("model bundle unavailable: %s", self.model_error)

    # ------------------------------------------------------------------ metadata
    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "model_id": self.ensemble.model_id if self.ensemble else None,
            "model_error": self.model_error,
            "solver": {"name": SOLVER_NAME, "version": SOLVER_VERSION, "preset": self.fem_preset},
        }

    def model_card(self) -> dict[str, Any]:
        if not self.ensemble:
            return {"available": False, "reason": self.model_error}
        return {"available": True, **self.ensemble.manifest}

    def describe_domain(self) -> dict[str, Any]:
        return {
            "case_schema": "physix.case/1",
            "units": "SI: metres, pascals, newtons",
            "analysis": "2D linear-elastic static, plane stress, isotropic",
            "families": {
                "plate": "rectangle with up to 6 circular holes, left edge supported, right edge loaded",
                "bracket": "L-bracket hung from the clamped top of its web, load on the flange tip",
            },
            "load_kinds": {
                "traction": "uniform traction in Pa on the load edge",
                "force": "resultant force in N, converted with the edge length and thickness",
            },
            "surrogate_domain": DOMAIN,
            "materials": {
                k: {"young": m.young, "poisson": m.poisson} for k, m in MATERIALS.items()
            },
            "out_of_scope": [
                "3D",
                "shell bending",
                "dynamics",
                "buckling",
                "contact",
                "fracture",
                "plasticity",
                "large deformation",
                "nonlinear materials",
            ],
            "examples": self.examples(),
        }

    def examples(self) -> dict[str, Any]:
        return {"plate": plate_dict(), "bracket": bracket_dict()}

    # ------------------------------------------------------------------ predict
    def _surrogate(self, case: Case) -> tuple[dict[str, Any], Any, np.ndarray]:
        assert self.ensemble is not None
        t0 = time.perf_counter()
        result, mask, stages = self.ensemble.predict(case)
        stages["total_ms"] = 1e3 * (time.perf_counter() - t0)
        return stages, result, mask

    def _fem(self, case: Case, preset: str | None = None) -> dict[str, Any]:
        t0 = time.perf_counter()
        unit = solve_unit(case, preset or self.fem_preset)
        sol = unit.combine()
        out: dict[str, Any] = {"unit": unit, "solution": sol}
        if fits_frame(case):
            targets, mask = rasterize_unit_solution(unit)
            stress = combine_targets(targets.astype(np.float64), case.traction())
            out.update(targets=targets, mask=mask, stress=stress, vm=raster_von_mises(stress))
            out["raster_hotspot"] = raster_hotspot(out["vm"], mask, case)
        out["total_ms"] = 1e3 * (time.perf_counter() - t0)
        return out

    def _field(
        self, case: Case, stress: np.ndarray, vm: np.ndarray, std: np.ndarray | None
    ) -> dict[str, Any]:
        comps = [stress[0], stress[1], stress[2], vm]
        names = ["sxx", "syy", "txy", "von_mises"]
        if std is not None:
            comps.append(std)
            names.append("von_mises_std")
        return {
            "frame": frame(case),
            "components": names,
            "units": "Pa",
            "encoding": "base64-float32-le",
            "shape": [len(names), ROWS, COLS],
            "data": _b64(np.stack(comps)),
        }

    def _mesh_payload(self, unit: Any) -> dict[str, Any]:
        mesh = unit.mesh
        sol = unit.combine()
        nodal = sol.stress.nodal_average()
        vm = raster_von_mises(nodal.T)
        return {
            "points": _b64(mesh.points, np.float32),
            "triangles": _b64(mesh.triangles, np.int32),
            "von_mises": _b64(vm, np.float32),
            "stress": _b64(sol.stress.values, np.float32),
            "n_nodes": int(mesh.n_nodes),
            "n_triangles": int(len(mesh.triangles)),
            "encoding": (
                "base64 little-endian; points float32 (n,2) m, triangles int32 (m,3), "
                "von_mises float32 (n,) Pa nodal average, stress float32 (m,3,3) Pa at "
                "element vertices ordered (sxx, syy, txy)"
            ),
        }

    def _fem_response(
        self,
        case: Case,
        source: str,
        fem: dict[str, Any],
        include_field: bool,
        include_mesh: bool = False,
        preset: str | None = None,
    ) -> dict[str, Any]:
        sol = fem["solution"]
        unit = fem["unit"]
        hs = sol.hotspot()
        s = sol.summary()
        summary = _summary(case, hs, "mesh", s["max_von_mises"])
        summary.update(
            max_displacement=s["max_displacement"],
            reaction_force=s["reaction_force"],
            equilibrium_residual=s["equilibrium_residual"],
        )
        if "raster_hotspot" in fem:
            summary["raster_hotspot"] = fem["raster_hotspot"]
        resp: dict[str, Any] = {
            "schema": PREDICTION_SCHEMA,
            "source": source,
            "case_id": case.case_id(),
            "case": case.to_dict(),
            "summary": summary,
            "solver": {
                "name": SOLVER_NAME,
                "version": SOLVER_VERSION,
                "mesh_preset": preset or self.fem_preset,
                "nodes": int(unit.mesh.n_nodes),
                "elements": int(len(unit.mesh.triangles)),
                "element": "P2 triangle",
                "timing_ms": unit.timing.to_dict(),
            },
            "timing": {
                "total_ms": fem["total_ms"],
                "stages": {**unit.timing.to_dict()},
                "boundary": "server-side mesh + assemble + solve + recover + rasterise, excludes transport",
            },
        }
        if include_field and "stress" in fem:
            resp["field"] = self._field(case, fem["stress"], fem["vm"], None)
        if include_mesh:
            resp["mesh"] = self._mesh_payload(unit)
        return resp

    def _enqueue(
        self, case: Case, fem: dict[str, Any], reason: str | None
    ) -> dict[str, Any] | None:
        if not self.label_store or "targets" not in fem:
            return None
        try:
            return ingest_label(
                self.label_store,
                case,
                fem["targets"],
                fem["mask"],
                {
                    "source": "fem_fallback",
                    "reason": reason,
                    "solver": SOLVER_NAME,
                    "solver_version": SOLVER_VERSION,
                    "mesh_preset": self.fem_preset,
                    "model_id": self.ensemble.model_id if self.ensemble else None,
                },
            )
        except Exception as exc:  # label intake must never break a prediction
            log.warning("label intake failed: %s", exc)
            return {"status": "failed", "error": str(exc)}

    def predict(
        self,
        case_data: dict[str, Any],
        include_field: bool = False,
        force_fem: bool = False,
        include_mesh: bool = False,
    ) -> dict[str, Any]:
        try:
            case = case_from_dict(case_data)
        except CaseValidationError as exc:
            return _error(exc)
        domain = check_domain(case)
        uncertainty: dict[str, Any] = {"domain": domain.to_dict()}
        reason: str | None
        if force_fem:
            reason = "forced"
        elif self.ensemble is None:
            reason = "model_unavailable"
        else:
            stages, result, mask = self._surrogate(case)
            policy = self.ensemble.policy
            use, reason = decide(policy, result.disagreement, domain.in_domain)
            uncertainty.update(
                disagreement=result.disagreement,
                field_spread=result.field_spread,
                threshold=policy["threshold"],
                member_hotspots=[float(v) for v in result.member_hotspots],
                metric=policy.get("metric"),
            )
            if use:
                resp: dict[str, Any] = {
                    "schema": PREDICTION_SCHEMA,
                    "source": "surrogate",
                    "case_id": case.case_id(),
                    "case": case.to_dict(),
                    "model": {
                        "model_id": self.ensemble.model_id,
                        "dataset_id": self.ensemble.manifest.get("dataset_id"),
                    },
                    "summary": _summary(
                        case, result.hotspot, "raster", float(result.von_mises[mask].max())
                    ),
                    "uncertainty": uncertainty,
                    "fallback": {"used": False, "reason": None},
                    "evidence": self._evidence(),
                    "timing": {
                        "total_ms": stages.pop("total_ms"),
                        "stages": stages,
                        "boundary": "server-side encode + 5-member ONNX inference + statistics",
                    },
                }
                if include_field:
                    resp["field"] = self._field(
                        case, result.mean, result.von_mises, result.std_von_mises
                    )
                return resp
        try:
            with self._lock:
                fem = self._fem(case)
        except Exception as exc:  # SolverError, MeshError or numerical failure
            return {
                "error": "solver_failed",
                "message": f"{type(exc).__name__}: {exc}",
                "case_id": case.case_id(),
                "fallback_reason": reason,
            }
        source = "fem" if force_fem else "fem_fallback"
        resp = self._fem_response(case, source, fem, include_field, include_mesh)
        resp["uncertainty"] = uncertainty
        resp["fallback"] = {"used": source == "fem_fallback", "reason": reason}
        if self.ensemble is not None:
            resp["model"] = {"model_id": self.ensemble.model_id}
        if source == "fem_fallback":
            resp["label"] = self._enqueue(case, fem, reason)
        return resp

    def _evidence(self) -> dict[str, Any] | None:
        if not self.ensemble:
            return None
        policy = self.ensemble.policy
        test = policy.get("test", {})
        return {
            "reference": "scikit-fem on the identical case",
            "test_split_coverage": test.get("coverage"),
            "test_accepted_hotspot_error_p90": test.get("accepted_hotspot_error_quantile"),
            "test_cases": test.get("cases"),
        }

    # ------------------------------------------------------------------ verify
    def verify(
        self,
        case_data: dict[str, Any],
        prediction: dict[str, Any] | None = None,
        include_field: bool = False,
        include_mesh: bool = False,
        mesh_preset: str | None = None,
    ) -> dict[str, Any]:
        """Solve the identical case with FEM and report the discrepancy to a prediction.

        Without ``prediction``, the surrogate is run on the same case and compared field by
        field (regardless of the fallback policy, so the comparison is always available).
        ``mesh_preset`` overrides the service preset, for example with the level a
        convergence study promoted.
        """
        try:
            case = case_from_dict(case_data)
        except CaseValidationError as exc:
            return _error(exc)
        if mesh_preset is not None and mesh_preset not in MESH_PRESETS:
            return {
                "error": "invalid_request",
                "message": f"unknown mesh preset {mesh_preset!r}",
                "field": "mesh_preset",
            }
        try:
            with self._lock:
                fem = self._fem(case, mesh_preset)
        except Exception as exc:
            return {"error": "solver_failed", "message": f"{type(exc).__name__}: {exc}"}
        resp = self._fem_response(case, "fem", fem, include_field, include_mesh, preset=mesh_preset)
        discrepancy: dict[str, Any] = {}
        if prediction is not None:
            pred_id = prediction.get("case_id")
            if pred_id and pred_id != case.case_id():
                return {
                    "error": "case_mismatch",
                    "message": "the prediction was made for a different case",
                    "prediction_case_id": pred_id,
                    "case_id": case.case_id(),
                }
            pred_hot = (prediction.get("summary") or {}).get("hotspot", {}).get("von_mises")
            basis = (prediction.get("summary") or {}).get("hotspot_basis", "raster")
            ref = fem.get("raster_hotspot") if basis == "raster" else fem["solution"].hotspot()
            if pred_hot is not None and ref is not None:
                discrepancy["prediction_hotspot_error"] = (
                    abs(pred_hot - ref["von_mises"]) / ref["von_mises"]
                )
                discrepancy["prediction_hotspot_basis"] = basis
        if self.ensemble is not None and "stress" in fem:
            stages, result, mask = self._surrogate(case)
            errs = field_errors(result.mean, fem["stress"], fem["mask"])
            ref_hot = fem["raster_hotspot"]
            w = case.geometry.width
            discrepancy["surrogate"] = {
                "model_id": self.ensemble.model_id,
                "hotspot": result.hotspot,
                "hotspot_error": abs(result.hotspot["von_mises"] - ref_hot["von_mises"])
                / ref_hot["von_mises"],
                "hotspot_location_error": float(
                    np.hypot(result.hotspot["x"] - ref_hot["x"], result.hotspot["y"] - ref_hot["y"])
                ),
                "hotspot_location_error_rel": float(
                    np.hypot(result.hotspot["x"] - ref_hot["x"], result.hotspot["y"] - ref_hot["y"])
                    / w
                ),
                **errs,
                "disagreement": result.disagreement,
                "would_fallback": not decide(
                    self.ensemble.policy, result.disagreement, check_domain(case).in_domain
                )[0],
                "surrogate_ms": stages["total_ms"],
                "fem_ms": fem["total_ms"],
                "speedup": fem["total_ms"] / max(stages["total_ms"], 1e-6),
                "basis": "raster, same mask and units as the solver field",
            }
            if include_field:
                resp["surrogate_field"] = self._field(
                    case, result.mean, result.von_mises, result.std_von_mises
                )
        resp["discrepancy"] = discrepancy
        return resp

    # --------------------------------------------------------------- convergence
    def convergence(
        self,
        case_data: dict[str, Any],
        presets: list[str] | None = None,
        probes: list[Any] | None = None,
    ) -> dict[str, Any]:
        """Solve the case at three mesh presets and report a convergence study.

        ``probes`` are up to eight points ``{"x", "y"}`` in metres inside the solid, whose
        von Mises stress is reported at every level. See
        :func:`physics.convergence.convergence_study` for the pass rule and the promoted level.
        """
        try:
            case = case_from_dict(case_data)
        except CaseValidationError as exc:
            return _error(exc)
        names = list(presets) if presets is not None else list(STUDY_PRESETS)
        if not all(isinstance(n, str) for n in names):
            return {
                "error": "invalid_request",
                "message": "presets must be preset names",
                "field": "presets",
            }
        points: list[tuple[float, float]] = []
        for k, probe in enumerate(probes or []):
            try:
                points.append((float(probe["x"]), float(probe["y"])))
            except (TypeError, KeyError, ValueError):
                return {
                    "error": "invalid_request",
                    "message": f"probe {k + 1} must be an object with x and y in metres",
                    "field": "probes",
                }
        t0 = time.perf_counter()
        try:
            with self._lock:
                study = convergence_study(case, tuple(names), points)
        except ValueError as exc:
            field = "probes" if "probe" in str(exc) else "presets"
            return {"error": "invalid_request", "message": str(exc), "field": field}
        except Exception as exc:
            return {"error": "solver_failed", "message": f"{type(exc).__name__}: {exc}"}
        return {
            "schema": CONVERGENCE_SCHEMA,
            "source": "fem",
            "case_id": case.case_id(),
            "solver": {"name": SOLVER_NAME, "version": SOLVER_VERSION, "element": "P2 triangle"},
            "presets": {
                level.preset: MESH_PRESETS[level.preset].to_dict() for level in study.levels
            },
            **study.to_dict(),
            "hotspot_rule": "maximum von Mises outside the support exclusion band, mesh basis",
            "timing": {
                "total_ms": 1e3 * (time.perf_counter() - t0),
                "boundary": "three server-side solves and comparisons, excludes transport",
            },
        }

    # ------------------------------------------------------------------ optimize
    def optimize(self, request: dict[str, Any]) -> dict[str, Any]:
        from physix_mcp.optimize import run_optimization

        return run_optimization(self, request)
