"""Bounded geometry optimization with surrogate screening and solver verification.

Only geometry variables the caller names may change, each inside the caller's bounds. The
search:

1. evaluates the baseline and a seeded Latin-hypercube sample of candidates with the fast
   estimator (the surrogate when the case is inside its domain, otherwise a coarse FEM mesh),
2. refines the best feasible candidate with a shrinking coordinate pattern search,
3. re-solves the baseline and the best few candidates with the reference FEM mesh and selects
   the best candidate that is feasible **under the solver**.

An improvement is reported as verified only when both the baseline and the selected candidate
were solved with FEM; otherwise the response says so explicitly.
"""

from __future__ import annotations

import copy
import re
import time
from typing import Any

import numpy as np

from data.domain import check_domain
from physics.case import Case, CaseValidationError, case_from_dict
from physics.geometry import solid_area
from physics.materials import YIELD_STRENGTH
from physics.solver import solve

OPTIMIZE_SCHEMA = "physix.optimize/1"
OBJECTIVES = ("min_max_von_mises", "min_volume")
MAX_BUDGET = 400
MAX_VARIABLES = 8
VERIFY_TOP = 3
_PATH = re.compile(
    r"^geometry\.(?:(width|height|web_width|flange_height|fillet_radius)|holes\[(\d+)\]\.(x|y|radius))$"
)


class OptimizeRequestError(ValueError):
    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field

    def to_dict(self) -> dict[str, Any]:
        return {"error": "invalid_request", "message": str(self), "field": self.field}


def _set(case_data: dict[str, Any], path: str, value: float) -> None:
    m = _PATH.match(path)
    assert m
    geom = case_data["geometry"]
    if m.group(1):
        geom[m.group(1)] = value
    else:
        geom["holes"][int(m.group(2))][m.group(3)] = value


def _get(case_data: dict[str, Any], path: str) -> float:
    m = _PATH.match(path)
    assert m
    geom = case_data["geometry"]
    if m.group(1):
        return float(geom[m.group(1)])
    return float(geom["holes"][int(m.group(2))][m.group(3)])


def parse_request(request: dict[str, Any]) -> tuple[Case, dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(request, dict):
        raise OptimizeRequestError("request must be an object")
    case_data = request.get("case")
    case = case_from_dict(case_data)  # raises CaseValidationError
    base = case.to_dict()
    variables = request.get("variables")
    if not isinstance(variables, list) or not variables:
        raise OptimizeRequestError("variables must be a non-empty list", "variables")
    if len(variables) > MAX_VARIABLES:
        raise OptimizeRequestError(f"at most {MAX_VARIABLES} variables", "variables")
    out = []
    seen = set()
    for k, v in enumerate(variables):
        field = f"variables[{k}]"
        if not isinstance(v, dict):
            raise OptimizeRequestError("each variable is {path, min, max}", field)
        path = v.get("path")
        if not isinstance(path, str) or not _PATH.match(path):
            raise OptimizeRequestError(
                "path must be a geometry parameter such as geometry.holes[0].x", f"{field}.path"
            )
        if path in seen:
            raise OptimizeRequestError("duplicate variable", f"{field}.path")
        seen.add(path)
        m = _PATH.match(path)
        assert m
        if m.group(2) is not None and int(m.group(2)) >= len(base["geometry"]["holes"]):
            raise OptimizeRequestError("hole index out of range", f"{field}.path")
        if (
            m.group(1) in ("web_width", "flange_height", "fillet_radius")
            and case.family != "bracket"
        ):
            raise OptimizeRequestError("bracket parameter on a plate", f"{field}.path")
        try:
            lo, hi = float(v["min"]), float(v["max"])
        except (KeyError, TypeError, ValueError):
            raise OptimizeRequestError("min and max must be numbers in metres", field) from None
        if not (np.isfinite(lo) and np.isfinite(hi) and lo < hi):
            raise OptimizeRequestError("require finite min < max", field)
        out.append({"path": path, "min": lo, "max": hi, "baseline": _get(base, path)})
    objective = request.get("objective", "min_max_von_mises")
    if objective not in OBJECTIVES:
        raise OptimizeRequestError(f"objective must be one of {OBJECTIVES}", "objective")
    constraints = request.get("constraints") or {}
    if not isinstance(constraints, dict):
        raise OptimizeRequestError("constraints must be an object", "constraints")
    allowed = {"max_von_mises", "min_safety_factor"}
    unknown = set(constraints) - allowed
    if unknown:
        raise OptimizeRequestError(f"unknown constraints {sorted(unknown)}", "constraints")
    for key, val in constraints.items():
        if not isinstance(val, int | float) or val <= 0:
            raise OptimizeRequestError(
                "constraint values must be positive numbers", f"constraints.{key}"
            )
    if "min_safety_factor" in constraints and case.material.name not in YIELD_STRENGTH:
        raise OptimizeRequestError(
            "min_safety_factor needs a named material with a yield strength", "constraints"
        )
    if objective == "min_volume" and not constraints:
        raise OptimizeRequestError("min_volume needs a stress constraint", "constraints")
    budget = int(request.get("budget", 64))
    if not 8 <= budget <= MAX_BUDGET:
        raise OptimizeRequestError(f"budget must be between 8 and {MAX_BUDGET}", "budget")
    opts = {
        "objective": objective,
        "constraints": dict(constraints),
        "budget": budget,
        "seed": int(request.get("seed", 0)),
        "base": base,
    }
    return case, opts, out


def _candidate(
    base: dict[str, Any], variables: list[dict[str, Any]], x: np.ndarray
) -> dict[str, Any]:
    data = copy.deepcopy(base)
    for v, value in zip(variables, x, strict=True):
        _set(data, v["path"], float(value))
    data.pop("meta", None)
    return data


class _Evaluator:
    """Fast estimator with caching: surrogate when in domain, coarse FEM otherwise."""

    def __init__(self, service: Any, objective: str, constraints: dict[str, float]) -> None:
        self.service = service
        self.objective = objective
        self.constraints = constraints
        self.cache: dict[str, dict[str, Any]] = {}
        self.counts = {"surrogate": 0, "fem_fast": 0, "invalid": 0}

    def metrics(self, case: Case, vm: float) -> dict[str, Any]:
        sy = YIELD_STRENGTH.get(case.material.name)
        sf = sy / vm if sy and vm > 0 else None
        volume = solid_area(case) * case.thickness
        violations = []
        if "max_von_mises" in self.constraints and vm > self.constraints["max_von_mises"]:
            violations.append("max_von_mises")
        if "min_safety_factor" in self.constraints and (
            sf is None or sf < self.constraints["min_safety_factor"]
        ):
            violations.append("min_safety_factor")
        obj = vm if self.objective == "min_max_von_mises" else volume
        return {
            "hotspot_von_mises": vm,
            "safety_factor": sf,
            "volume": volume,
            "objective": obj,
            "feasible": not violations,
            "violations": violations,
        }

    def __call__(self, data: dict[str, Any]) -> dict[str, Any]:
        try:
            case = case_from_dict(data)
        except CaseValidationError as exc:
            self.counts["invalid"] += 1
            return {"valid": False, "reason": exc.to_dict()["message"]}
        key = case.case_id()
        if key in self.cache:
            return self.cache[key]
        ens = self.service.ensemble
        if ens is not None and check_domain(case).in_domain:
            result, _, _ = ens.predict(case)
            vm = float(result.hotspot["von_mises"])
            out = {"valid": True, "estimator": "surrogate", "disagreement": result.disagreement}
            self.counts["surrogate"] += 1
        else:
            try:
                vm = float(solve(case, "fast").hotspot()["von_mises"])
            except Exception as exc:
                self.counts["invalid"] += 1
                return {"valid": False, "reason": f"solver: {exc}"}
            out = {"valid": True, "estimator": "fem_fast"}
            self.counts["fem_fast"] += 1
        out.update(self.metrics(case, vm), case_id=key)
        self.cache[key] = out
        return out


def _rank(entry: dict[str, Any]) -> tuple[int, float]:
    """Feasible first, then objective; infeasible ranked by objective too."""
    return (0 if entry["feasible"] else 1, entry["objective"])


def _lhs(rng: np.random.Generator, n: int, d: int) -> np.ndarray:
    cut = (np.arange(n)[:, None] + rng.random((n, d))) / n
    for j in range(d):
        cut[:, j] = cut[rng.permutation(n), j]
    return cut


def run_optimization(service: Any, request: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    try:
        case, opts, variables = parse_request(request)
    except CaseValidationError as exc:
        return exc.to_dict()
    except OptimizeRequestError as exc:
        return exc.to_dict()
    lo = np.array([v["min"] for v in variables])
    hi = np.array([v["max"] for v in variables])
    span = hi - lo
    base = opts["base"]
    evaluate = _Evaluator(service, opts["objective"], opts["constraints"])
    history: list[dict[str, Any]] = []

    def run(x: np.ndarray, stage: str) -> dict[str, Any] | None:
        data = _candidate(base, variables, x)
        r = evaluate(data)
        if not r.get("valid"):
            return None
        entry = {**r, "x": [float(v) for v in x], "case": data, "stage": stage}
        history.append(entry)
        return entry

    x0 = np.array([v["baseline"] for v in variables])
    baseline_est = run(x0, "baseline")
    budget = opts["budget"]
    rng = np.random.default_rng(opts["seed"])
    n_screen = max(4, budget // 2)
    for u in _lhs(rng, n_screen, len(variables)):
        run(lo + u * span, "screen")
    if not history:
        return {"error": "no_valid_candidate", "message": "no candidate produced a valid geometry"}

    # Pattern search from the best screened point.
    best = min(history, key=_rank)
    x = np.array(best["x"])
    step = 0.25 * span
    evals = len(history)
    while evals < budget and np.max(step / span) > 0.01:
        improved = False
        for j in range(len(variables)):
            for sign in (1.0, -1.0):
                if evals >= budget:
                    break
                trial = x.copy()
                trial[j] = np.clip(trial[j] + sign * step[j], lo[j], hi[j])
                if np.allclose(trial, x):
                    continue
                entry = run(trial, "refine")
                evals += 1
                if entry is not None and _rank(entry) < _rank(best):
                    best, x, improved = entry, trial, True
        if not improved:
            step = step / 2

    # Solver verification of the baseline and the top distinct candidates.
    ranked = []
    seen = set()
    for e in sorted(history, key=_rank):
        if e["case_id"] in seen or e["stage"] == "baseline":
            continue
        seen.add(e["case_id"])
        ranked.append(e)
        if len(ranked) == VERIFY_TOP:
            break

    def fem_check(entry: dict[str, Any]) -> dict[str, Any]:
        t = time.perf_counter()
        try:
            c = case_from_dict(entry["case"])
            sol = solve(c, service.fem_preset)
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        vm = float(sol.hotspot()["von_mises"])
        m = evaluate.metrics(c, vm)
        return {
            "ok": True,
            **m,
            "estimate_error": abs(entry["hotspot_von_mises"] - vm) / vm,
            "solve_ms": 1e3 * (time.perf_counter() - t),
            "mesh_preset": service.fem_preset,
            "hotspot_basis": "mesh",
        }

    base_entry = baseline_est or {
        "x": [float(v) for v in x0],
        "case": _candidate(base, variables, x0),
        "hotspot_von_mises": float("nan"),
    }
    baseline_fem = fem_check(base_entry)
    verified = []
    for e in ranked:
        e = {k: v for k, v in e.items() if k != "case"} | {"case": e["case"]}
        e["fem"] = fem_check(e)
        verified.append(e)
    ok = [e for e in verified if e["fem"]["ok"]]
    feasible = [e for e in ok if e["fem"]["feasible"]]
    pool = feasible or ok
    selected = min(pool, key=lambda e: e["fem"]["objective"]) if pool else None

    improvement = None
    verified_improvement = False
    if selected and baseline_fem.get("ok"):
        b, s = baseline_fem["objective"], selected["fem"]["objective"]
        improvement = {
            "objective_baseline": b,
            "objective_selected": s,
            "relative_change": (s - b) / b,
        }
        verified_improvement = bool(
            selected["fem"]["feasible"] and s < b and (baseline_fem["feasible"] or s <= b)
        )

    def public(e: dict[str, Any]) -> dict[str, Any]:
        return {
            "variables": {v["path"]: val for v, val in zip(variables, e["x"], strict=True)},
            "estimate": {
                k: e.get(k)
                for k in ("estimator", "hotspot_von_mises", "objective", "feasible", "disagreement")
            },
            "fem": e.get("fem"),
            "case": e["case"],
        }

    return {
        "schema": OPTIMIZE_SCHEMA,
        "objective": opts["objective"],
        "constraints": opts["constraints"],
        "variables": [{k: v[k] for k in ("path", "min", "max", "baseline")} for v in variables],
        "baseline": {
            "variables": {v["path"]: v["baseline"] for v in variables},
            "estimate": {
                k: base_entry.get(k)
                for k in ("estimator", "hotspot_von_mises", "objective", "feasible")
            },
            "fem": baseline_fem,
            "case": base_entry["case"],
        },
        "selected": public(selected) if selected else None,
        "candidates_verified": [public(e) for e in verified],
        "improvement": improvement,
        "verified_improvement": verified_improvement,
        "feasible_found": bool(feasible),
        "search": {
            "seed": opts["seed"],
            "budget": budget,
            "evaluations": len(history),
            "estimators": evaluate.counts,
            "method": "seeded Latin-hypercube screening + coordinate pattern search, FEM verification of the top candidates",
            "trace": [
                {"stage": e["stage"], "objective": e["objective"], "feasible": e["feasible"]}
                for e in history
            ],
        },
        "timing": {
            "total_ms": 1e3 * (time.perf_counter() - t0),
            "boundary": "server-side, includes FEM verification",
        },
    }
