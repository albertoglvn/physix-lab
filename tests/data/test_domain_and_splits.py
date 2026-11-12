import numpy as np

from data.domain import (
    DOMAIN,
    assign_split,
    check_domain,
    group_id,
    sample_base,
    sample_shifted_plate,
)
from data.generate import SPLIT_FRACTIONS, plan_cases
from physics.case import case_from_dict
from physics.examples import example_bracket, example_plate, plate_dict


def test_examples_are_in_domain():
    assert check_domain(example_plate()).in_domain
    assert check_domain(example_bracket()).in_domain


def test_domain_reasons_are_explicit():
    data = plate_dict()
    data["geometry"]["holes"][0]["radius"] = 0.025  # 0.125 x width
    data["support"] = "roller"
    data["material"]["poisson"] = 0.45
    result = check_domain(case_from_dict(data))
    assert not result.in_domain
    text = " ".join(result.reasons)
    assert "radius" in text and "support" in text and "poisson" in text


def test_sampling_is_seeded_and_in_domain():
    a = [sample_base(np.random.default_rng(3), "plate") for _ in range(1)]
    b = [sample_base(np.random.default_rng(3), "plate") for _ in range(1)]
    assert a == b
    rng = np.random.default_rng(11)
    for family in ("plate", "bracket"):
        for _ in range(25):
            base = sample_base(rng, family)
            assert base is not None
            assert check_domain(case_from_dict(base)).in_domain


def test_shifted_slice_is_out_of_domain():
    design = sample_shifted_plate(np.random.default_rng(5))
    result = check_domain(case_from_dict(design))
    assert not result.in_domain and "radius" in result.reasons[0]


def test_split_assignment_is_deterministic_and_balanced():
    groups = [group_id(1, "plate", i) for i in range(4000)]
    splits = [assign_split(g, SPLIT_FRACTIONS) for g in groups]
    assert splits == [assign_split(g, SPLIT_FRACTIONS) for g in groups]
    for name, frac in SPLIT_FRACTIONS.items():
        assert abs(splits.count(name) / len(splits) - frac) < 0.03


def test_plan_keeps_groups_in_one_split_and_is_reproducible():
    records, _ = plan_cases(seed=9, groups=12, variants=3, shifted=2)
    again, _ = plan_cases(seed=9, groups=12, variants=3, shifted=2)
    assert records == again
    by_group: dict[str, set[str]] = {}
    for r in records:
        by_group.setdefault(r["group"], set()).add(r["split"])
    assert all(len(s) == 1 for s in by_group.values())
    assert sum(r["split"] == "shifted" for r in records) == 2
    families = {r["case"]["family"] for r in records}
    assert families == {"plate", "bracket"}
    assert DOMAIN["version"] == "physix.domain/1"
