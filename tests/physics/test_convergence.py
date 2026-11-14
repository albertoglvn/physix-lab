"""Three-level convergence study: Richardson extrapolation, GCI, pass rule and probes."""

import json
import math
from pathlib import Path

import pytest

from data.fixtures import CONVERGENCE_PROBES
from physics.convergence import (
    FORMAL_ORDER,
    GCI_SAFETY_FACTOR,
    GCI_SAFETY_FACTOR_FORMAL,
    HOTSPOT_TOLERANCE,
    MAX_STUDY_PROBES,
    convergence_study,
    observed_order,
    richardson,
)
from physics.examples import example_plate, plate_dict
from physics.mesh import MESH_PRESETS

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "convergence_v1.json"

# Unequal refinement ratios, as the mesh presets give: r21 = 1.6, r32 = 1.25.
H = (0.5, 0.8, 1.0)


def _manufactured(p: float, phi0: float = 10.0, c: float = 3.0) -> tuple[float, float, float]:
    return tuple(phi0 + c * h**p for h in H)  # type: ignore[return-value]


@pytest.mark.parametrize("p", [1.0, 1.5, 2.0])
def test_richardson_recovers_manufactured_order_and_limit(p):
    r = richardson(H, _manufactured(p))
    assert r.kind == "monotonic"
    assert r.order == pytest.approx(p, rel=1e-8)
    assert r.order_used == pytest.approx(p, rel=1e-8)
    assert r.extrapolated == pytest.approx(10.0, rel=1e-10)
    phi1, phi2, _ = _manufactured(p)
    e = abs(phi2 - phi1) / phi1
    assert r.error_fine == pytest.approx(e)
    assert r.gci_fine == pytest.approx(GCI_SAFETY_FACTOR * e / (1.6**p - 1))
    # The GCI band covers the true error of the finest value.
    assert r.gci_fine >= abs(phi1 - 10.0) / phi1


def test_order_above_formal_is_capped_for_the_band():
    r = richardson(H, _manufactured(3.0))
    assert r.order == pytest.approx(3.0, rel=1e-8)
    assert r.order_used == FORMAL_ORDER
    phi1, phi2, _ = _manufactured(3.0)
    assert r.gci_fine == pytest.approx(
        GCI_SAFETY_FACTOR * abs(phi2 - phi1) / phi1 / (1.6**FORMAL_ORDER - 1)
    )


def test_observed_order_matches_closed_form_for_constant_ratio():
    e21, e32 = 0.25, 1.0  # p = log(4) / log(2)
    assert observed_order(e21, e32, 2.0, 2.0) == pytest.approx(2.0)


def test_oscillatory_divergent_and_converged_cases():
    osc = richardson(H, (10.0, 10.1, 9.95))
    assert osc.kind == "oscillatory" and osc.extrapolated is None
    assert osc.safety_factor == GCI_SAFETY_FACTOR_FORMAL
    assert osc.gci_fine == pytest.approx(3.0 * 0.01 / (1.6**2 - 1))
    div = richardson(H, (10.0, 10.2, 10.25))
    assert div.kind == "divergent" and div.order is None and div.extrapolated is None
    flat = richardson(H, (10.0, 10.0, 10.3))
    assert flat.kind == "converged" and flat.gci_fine == 0.0 and flat.extrapolated == 10.0


def test_divergence_limit_follows_unequal_ratios():
    # R = 1.17 / 1.08 > 1, yet phi = 10 + 3 h^2 converges because r21 > r32.
    assert richardson(H, _manufactured(2.0)).kind == "monotonic"
    limit = math.log(1.6) / math.log(1.25)
    phi = (10.0, 10.0 + 1.01 * limit, 11.0 + 1.01 * limit)
    assert richardson(H, phi).kind == "divergent"


def test_richardson_rejects_unordered_sizes():
    with pytest.raises(ValueError):
        richardson((1.0, 0.8, 0.5), (1.0, 2.0, 3.0))


def test_plate_study_orders_levels_and_promotes_the_finest_passing():
    case = example_plate()
    g = case.geometry
    probe = (0.1 * g.width, 0.5 * g.height)
    study = convergence_study(case, probes=[probe])
    names = [level.preset for level in study.levels]
    assert names == ["fast", "reference", "fine"]
    sizes = [level.element_size for level in study.levels]
    assert sizes[0] > sizes[1] > sizes[2] > 0
    assert [level.nodes for level in study.levels] == sorted(level.nodes for level in study.levels)
    assert study.levels[-1].to_finer is None
    assert all(level.to_finer is not None for level in study.levels[:2])
    # Celik et al. recommend refinement ratios above 1.3 between neighbouring levels.
    assert sizes[0] / sizes[1] > 1.3 and sizes[1] / sizes[2] > 1.3
    assert set(names) == set(MESH_PRESETS)
    assert study.hotspot.gci_fine <= HOTSPOT_TOLERANCE
    assert study.promoted == "fine"
    assert len(study.probes) == 1 and all(len(level.probes) == 1 for level in study.levels)
    d = study.to_dict()
    assert d["promoted"] == "fine" and d["probes"][0]["x"] == probe[0]
    finest = study.levels[-1].hotspot["von_mises"]
    if study.hotspot.extrapolated is not None:
        assert abs(study.hotspot.extrapolated - finest) / finest <= study.hotspot.gci_fine + 1e-12


def test_promotion_falls_back_to_a_coarser_level(monkeypatch):
    import physics.convergence as conv

    real = conv.richardson

    def wide(h, phi):
        r = real(h, phi)
        return conv.Richardson(**{**r.__dict__, "gci_fine": 0.5})

    monkeypatch.setattr(conv, "richardson", wide)
    study = conv.convergence_study(example_plate())
    assert not study.levels[-1].passes
    assert study.promoted == "reference"


def test_study_rejects_bad_presets_and_probes():
    case = example_plate()
    with pytest.raises(ValueError, match="three different"):
        convergence_study(case, ("fast", "fast", "fine"))
    with pytest.raises(ValueError, match="unknown mesh preset"):
        convergence_study(case, ("fast", "reference", "huge"))
    with pytest.raises(ValueError, match="outside the solid"):
        convergence_study(case, probes=[(-1.0, 0.0)])
    hole = case.geometry.holes[0]
    with pytest.raises(ValueError, match="outside the solid"):
        convergence_study(case, probes=[(hole.x, hole.y)])
    with pytest.raises(ValueError, match="at most"):
        convergence_study(case, probes=[(0.01, 0.01)] * (MAX_STUDY_PROBES + 1))


def test_convergence_fixture_is_self_consistent():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    study = fixture["study"]
    assert fixture["case"] == plate_dict()
    assert [(p["x"], p["y"]) for p in study["probes"]] == CONVERGENCE_PROBES
    sizes = [level["element_size"] for level in study["levels"]]
    assert sizes == sorted(sizes, reverse=True)
    passing = [level["preset"] for level in study["levels"] if level["passes"]]
    assert study["promoted"] == (passing[-1] if passing else None)
    for level in study["levels"]:
        assert level["solve_ms"] == 0.0 and len(level["probes"]) == len(CONVERGENCE_PROBES)
    phi = [level["hotspot"]["von_mises"] for level in reversed(study["levels"])]
    fit = richardson(tuple(reversed(sizes)), tuple(phi))
    assert fit.to_dict() == pytest.approx(study["hotspot"])
