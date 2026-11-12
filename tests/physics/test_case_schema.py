import copy

import pytest

from physics.case import (
    CaseValidationError,
    UnsupportedCaseError,
    case_from_dict,
)
from physics.examples import bracket_dict, plate_dict


def test_round_trip_preserves_case_and_identity():
    case = case_from_dict(plate_dict())
    again = case_from_dict(case.to_dict())
    assert again == case
    assert again.case_id() == case.case_id()
    assert case.case_id().startswith("case_")


def test_case_id_ignores_metadata_and_material_name():
    a = plate_dict()
    b = copy.deepcopy(a)
    b["meta"] = {"note": "x"}
    b["material"]["name"] = "renamed"
    assert case_from_dict(a).case_id() == case_from_dict(b).case_id()
    b["geometry"]["holes"][0]["radius"] = 0.011
    assert case_from_dict(a).case_id() != case_from_dict(b).case_id()


def test_force_converts_to_traction_with_thickness():
    case = case_from_dict(bracket_dict())
    tx, ty = case.traction()
    # 500 N over flange_height 0.03 m x thickness 0.005 m.
    assert tx == 0.0
    assert ty == pytest.approx(-500.0 / (0.03 * 0.005))
    fx, fy = case.resultant_force()
    assert fy == pytest.approx(-500.0)


@pytest.mark.parametrize(
    ("path", "value", "fragment"),
    [
        (("geometry", "width"), -1.0, "width"),
        (("geometry", "height"), 10.0, "height"),
        (("thickness",), 0.0, "thickness"),
        (("material", "poisson"), 0.5, "poisson"),
        (("material", "young"), "steel", "number"),
        (("load", "x"), float("nan"), "finite"),
        (("family",), "shell", "family"),
        (("support",), "pinned", "support"),
    ],
)
def test_invalid_fields_are_rejected(path, value, fragment):
    data = plate_dict()
    target = data
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(CaseValidationError, match=fragment):
        case_from_dict(data)


def test_zero_load_is_rejected():
    data = plate_dict()
    data["load"] = {"kind": "traction", "x": 0.0, "y": 0.0}
    with pytest.raises(CaseValidationError, match="non-zero"):
        case_from_dict(data)


@pytest.mark.parametrize(
    ("analysis", "fragment"),
    [
        ({"dimension": 3}, "3D"),
        ({"type": "buckling"}, "buckling"),
        ({"type": "modal"}, "dynamics"),
        ({"material_model": "plasticity"}, "plasticity"),
        ({"formulation": "shell"}, "shell"),
    ],
)
def test_out_of_scope_requests_raise_unsupported(analysis, fragment):
    data = plate_dict()
    data["analysis"] = analysis
    with pytest.raises(UnsupportedCaseError, match=fragment) as info:
        case_from_dict(data)
    assert info.value.to_dict()["error"] == "unsupported_case"


def test_supported_analysis_block_is_accepted():
    data = plate_dict()
    data["analysis"] = {"type": "linear_static", "dimension": 2}
    case_from_dict(data)


def test_thick_plate_is_out_of_plane_stress_scope():
    data = plate_dict()
    data["thickness"] = 0.05
    with pytest.raises(UnsupportedCaseError, match="plane-stress"):
        case_from_dict(data)


def test_schema_version_is_checked():
    data = plate_dict()
    data["schema"] = "physix.case/0"
    with pytest.raises(CaseValidationError, match="schema"):
        case_from_dict(data)


def test_roller_support_is_plate_only():
    data = bracket_dict()
    data["support"] = "roller"
    with pytest.raises(CaseValidationError, match="Roller"):
        case_from_dict(data)


def test_scaled_load_scales_traction():
    case = case_from_dict(plate_dict())
    scaled = case.scaled_load(2.5)
    assert scaled.traction()[0] == pytest.approx(2.5 * case.traction()[0])
