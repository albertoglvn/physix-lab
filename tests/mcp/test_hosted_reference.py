"""Evidence for the same-case reference data used by the hosted connector."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from physics.case import case_from_dict
from physics.solver import SOLVER_VERSION, solve

REFERENCE = json.loads(
    (Path(__file__).resolve().parents[2] / "mcp/sites/reference-stress.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize(
    ("family", "radius", "scale"), [("plate", 0.018, 2), ("bracket", 0.008, 0.5)]
)
def test_hosted_reference_matches_identical_scikit_fem_case(
    family: str, radius: float, scale: float
) -> None:
    entry = REFERENCE["families"][family]
    row = next(record for record in entry["results"] if record["radius_m"] == radius)
    data = deepcopy(entry["example"])
    data["geometry"]["holes"][0]["radius"] = radius
    case = case_from_dict(data)
    assert row["reference_case_id"] == case.case_id()
    assert REFERENCE["solver"]["version"] == SOLVER_VERSION

    result = solve(case.scaled_load(scale), "reference")
    assert result.mesh.n_nodes == row["mesh"]["nodes"]
    assert result.mesh.n_elements == row["mesh"]["elements"]
    actual = result.summary()
    assert actual["max_von_mises"] == pytest.approx(
        row["summary"]["max_von_mises"] * scale, rel=1e-5
    )
    assert actual["hotspot"]["von_mises"] == pytest.approx(
        row["summary"]["hotspot"]["von_mises"] * scale, rel=1e-5
    )
