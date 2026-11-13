"""Generate compact scikit-fem reference cases for the Sites connector."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from physics.case import case_from_dict
from physics.examples import bracket_dict, plate_dict
from physics.mesh import MESH_PRESETS
from physics.solver import SOLVER_NAME, SOLVER_VERSION, solve

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "mcp" / "sites" / "reference-stress.json"
RADII = {"plate": (0.008, 0.010, 0.012, 0.014, 0.016, 0.018), "bracket": (0.006, 0.008, 0.010)}


def build_reference() -> dict[str, Any]:
    families = {}
    for name, example in (("plate", plate_dict()), ("bracket", bracket_dict())):
        results = []
        for radius_m in RADII[name]:
            case_data = deepcopy(example)
            case_data["geometry"]["holes"][0]["radius"] = radius_m
            case = case_from_dict(case_data)
            solution = solve(case, "reference")
            summary = solution.summary()
            hotspot = summary["hotspot"]
            results.append(
                {
                    "radius_m": radius_m,
                    "reference_case_id": case.case_id(),
                    "mesh": {
                        "nodes": solution.mesh.n_nodes,
                        "elements": solution.mesh.n_elements,
                    },
                    "summary": {
                        "max_von_mises": summary["max_von_mises"],
                        "hotspot": hotspot,
                        "max_displacement": summary["max_displacement"],
                        "equilibrium_residual": summary["equilibrium_residual"],
                    },
                }
            )
        families[name] = {"example": example, "results": results}
    return {
        "schema": "physix.hosted-reference/1",
        "solver": {
            "name": SOLVER_NAME,
            "version": SOLVER_VERSION,
            "mesh_preset": "reference",
            "mesh_settings": MESH_PRESETS["reference"].to_dict(),
        },
        "families": families,
    }


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(build_reference(), indent=2) + "\n", encoding="utf-8")
