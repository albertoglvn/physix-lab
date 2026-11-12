"""Physix MCP server (stdio). Run with ``make mcp`` or ``python -m scripts.run_feature physix_mcp.server``.

Protocol messages own stdout; every log line goes to stderr.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

from mcp.server.fastmcp import FastMCP

from physix_mcp.service import PhysixService

log = logging.getLogger("physix")

INSTRUCTIONS = """Physix estimates 2D plane-stress, linear-elastic stress fields for parametric plates and
L-brackets with circular holes. All inputs and outputs are SI (metres, pascals, newtons).
Call describe_domain first to see the case schema, examples and the surrogate domain.
predict_stress answers in milliseconds when the case is inside the trained domain and the
ensemble agrees; otherwise it solves with scikit-fem and says why (source fem_fallback).
verify_with_solver solves the identical case with FEM and reports the discrepancy.
optimize searches only the bounded geometry variables you name and FEM-checks the result.
Out of scope: 3D, shells, dynamics, buckling, contact, fracture, plasticity, large deformation."""


def build_server(service: PhysixService) -> FastMCP:
    server = FastMCP("physix", instructions=INSTRUCTIONS)

    @server.tool()
    def describe_domain() -> dict[str, Any]:
        """Case schema, units, supported families, materials, surrogate domain and examples."""
        return service.describe_domain()

    @server.tool()
    def predict_stress(case: dict[str, Any], include_field: bool = False) -> dict[str, Any]:
        """Estimate the stress field of a physix.case/1 case.

        Returns source (surrogate | fem_fallback), hotspot von Mises stress and location (Pa,
        m), stress concentration, indicative safety factor, ensemble disagreement and the
        calibrated threshold, fallback reason, and timing. include_field adds the 64x128 raster
        of sxx, syy, txy and von Mises as base64 float32.
        """
        return service.predict(case, include_field=include_field)

    @server.tool()
    def verify_with_solver(
        case: dict[str, Any], prediction: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Solve the identical case with scikit-fem (reference mesh) and report the discrepancy.

        Pass an earlier predict_stress response as prediction to measure its hotspot error. The
        surrogate is also compared field by field on the same mask when a model is loaded.
        """
        return service.verify(case, prediction=prediction)

    @server.tool()
    def optimize(
        case: dict[str, Any],
        variables: list[dict[str, Any]],
        objective: str = "min_max_von_mises",
        constraints: dict[str, float] | None = None,
        budget: int = 64,
        seed: int = 0,
    ) -> dict[str, Any]:
        """Search bounded geometry variables to minimise the objective, then FEM-verify.

        variables: [{"path": "geometry.holes[0].x", "min": 0.05, "max": 0.15}, ...] in metres.
        objective: min_max_von_mises | min_volume. constraints: {max_von_mises (Pa),
        min_safety_factor}. Returns baseline and selected designs with FEM results and whether
        the improvement is solver-verified.
        """
        return service.optimize(
            {
                "case": case,
                "variables": variables,
                "objective": objective,
                "constraints": constraints or {},
                "budget": budget,
                "seed": seed,
            }
        )

    return server


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Physix MCP server (stdio)")
    p.add_argument("--model", default=None, help="model bundle directory")
    p.add_argument("--no-labels", action="store_true", help="do not store fallback labels")
    a = p.parse_args(argv)
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="[physix] %(message)s")
    service = PhysixService(a.model, label_store=None if a.no_labels else "data/generated/labels")
    build_server(service).run("stdio")


if __name__ == "__main__":
    main()
