# First working version

## Integration contract

The first executable slice uses scikit-fem plane-stress analysis of a rectangular plate with one circular hole, a clamped left edge, and horizontal traction on the right edge. Inputs use SI units and a lower-left origin. The web interface converts to millimetres and megapascals.

`POST /api/solve` accepts width, height, thickness, hole_x, hole_y, hole_radius, young, poisson, traction, and resolution. Responses contain source, case_version, timing_ms, mesh counts, triangle vertices/connectivity, per-element stress components and von Mises stress, summary values, and an uncertainty reason. Results identify mesh limitations. Neural inference requires a separately trained and evaluated model bundle.

## Work ownership

- Physics work owns physics/, the local HTTP server, and physics tests in an isolated work-physics directory.
- Browser work owns web/ in an isolated work-web directory.
- Tooling work owns data generation, MCP tools, and corresponding tests in an isolated work-tools directory.
- Integration owns root tooling, documentation, validation, and publication. Isolated directories are excluded from Git and are integrated only after review.

## Environment findings

The terminal currently cannot resolve package registries. GNU Make and pnpm are unavailable. The bundled-runtime lookup failed. Existing uv caches are being inspected to recover the numerical dependencies. The GitHub connector has repository access, while local .git writes remain restricted.

## Acceptance checks

- Validated geometry and deterministic real FEM solution.
- Load scaling, equilibrium, invalid-input tests, and explicit convergence limitations.
- Browser loading, solve results, error feedback, controls, and JSON export.
- Localhost preview serves successfully and the API returns actual solver output.
- All published changes retain solver provenance and avoid unsupported accuracy or latency claims.
