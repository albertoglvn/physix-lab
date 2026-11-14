# Physix engineering instructions

## Product and scope

Physix is one browser lab with two studies, plus tools that let AI agents set up and check the same experiments.

- **Motion study.** Rigid-body mechanics in 3D with Rapier at a fixed 120 Hz step: blocks, balls, cylinders, ramps, Atwood pulleys (optionally sprung), pendulums, springs, spring bumpers, launches, applied forces and air drag. Every run records time series, compares them with closed-form theory where one applies, and supports sweeps, fits and exports.
- **Stress study.** Quick estimates of 2D stress fields for parametric plates and brackets with circular holes. Use small-strain, static, isotropic linear elasticity under plane stress. Support the material, load, boundary-condition, and geometry families declared in the dataset and model manifests.
- **Agent surfaces.** A local MCP server for the stress tools, and a hosted ChatGPT plugin that compares reference stress cases and builds and simulates Motion scenes with the lab's own code.

Keep the Stress study to 2D linear elasticity. Route unsupported requests to an explicit validation error. Out-of-scope requests include 3D, shell bending, dynamics, buckling, contact, fracture, plasticity, large deformation, and nonlinear material behavior. Report uncertainty and provenance with engineering estimates. Any stress comparison for a release or demo needs scikit-fem evidence.

## Architecture and ownership

| Path | Responsibilities and boundaries |
| --- | --- |
| `physics/` | Own the case schema, geometry validation, mesh and boundary tags, material and load assembly, solve, stress recovery, and mesh convergence checks. Keep this independent of training, MCP, and browser code. |
| `data/` | Sample valid cases deterministically, call the reference solver, map to a common grid, and emit versioned datasets and splits. Own ingestion and deduplication of active-learning labels. |
| `model/` | Train five independent U-Nets with recorded seeds. Compute ensemble mean and disagreement, calibrate the fallback policy, evaluate against the solver, and export all five models and metadata. |
| `mcp/physix_mcp/` | Validate tool inputs and orchestrate model inference, FEM fallback, and optimization. Import the external `mcp` SDK by its own name and keep Physix code under `physix_mcp`. Keep stdio protocol output clean and send logs to stderr. |
| `web/src/lab/` | Own the lab shell, the `physix.lab/2` scene contract, the Rapier simulation, probes, theory references, sweeps and the agent scene builder. The Motion engine must run identically in the browser, the headless CLI and the hosted Worker, so keep it free of DOM access outside the viewport and panels. |
| `web/` (rest) | Reproduce the stress feature encoding in TypeScript and run the ONNX ensemble locally. Run browser FEM in a Pyodide worker. Share the case and artifact contracts through fixtures and versioned metadata. Render field provenance, uncertainty, and comparable timings. Follow `docs/DESIGN.md` for tokens and layout and `docs/COPYWRITING.md` for every user-facing string. |
| `mcp/sites/` | The hosted ChatGPT Worker: `describe_domain`, `compare_stress`, `build_scene` and `simulate_scene`. It imports the lab's scene builder and motion run rather than copying them. `scripts/build_sites_worker.mjs` bundles it. |
| `skills/physix/` | Describe when to use each tool and how to interpret supported domains, provenance, uncertainty, and verification. |
| `scripts/`, `tests/`, `docs/` | Own command wiring, test suites, and shared implementation and demo documentation. |

Each document has one job. Change the owning document in the same change as the behaviour it describes.

| Document | Owns |
| --- | --- |
| `docs/CONTRACTS.md` | Every versioned schema, field, unit, default and accuracy bound that code or agents depend on |
| `docs/DESIGN.md` | Visual tokens, layout, panels and viewport rules |
| `docs/COPYWRITING.md` | Voice, positioning and the claims each workflow may make |
| `docs/LAB_PLAN.md` | The Lab v2 phases and their status |
| `docs/PHYSICS.md`, `docs/MODEL.md` | Stress solver reference and held-out model evaluation |
| `docs/CHATGPT.md` | Hosted plugin setup and tool behaviour |
| `docs/WORKLOG.md` | Branches, handoffs, checks and known limitations |
| `docs/DEMO.md` | The recorded demo: setup, shot list, script and evidence rules |

The reference path starts with a validated case, builds a mesh, solves with scikit-fem, and produces stress components. Rasterization maps the reference field and solid mask onto the model grid. The ensemble consumes the same case encoding and produces a field plus disagreement. The service sends uncertain but solver-supported cases through FEM and enqueues successful results for later training. Make the fallback policy and thresholds versioned with the model.

## Shared contracts and conventions

- Use SI units at Python, MCP, and dataset boundaries. Use metres for lengths and pascals for stress and modulus. Document whether a load is traction or a resultant force and preserve the thickness used to convert between them. Declare axis directions, coordinate origin, tensor order, and raster row orientation. Convert units for display at the edge of the system.
- Use `σxx`, `σyy`, and `τxy` as the initial stress components. Derive von Mises stress from components with a shared plane-stress formula. Keep the solid mask explicit. Exclude holes and outside pixels from loss, evaluation, and stress summaries.
- Version case schemas, datasets, and model bundles. Include case parameters, seeds, split membership, solver and mesh settings, raster conventions, and normalization in the relevant manifests. Fit normalization on training cases and apply those parameters at inference. Record checkpoint identities and hashes in exports.
- Keep feature code in its owning package. Use type annotations on public Python boundaries, explicit TypeScript types for shared contracts, Ruff for Python, and ESLint and Prettier for web. Keep stochastic operations seedable. Store generated datasets, weights, and browser model bundles outside Git.
- A response should identify its source, such as `surrogate`, `fem`, or `fem_fallback`, the case and artifact version where applicable, and timing boundaries. Keep model disagreement separate from solver error. Use calibrated thresholds and an explicit domain check. Persist successful fallback cases by case identity for offline retraining. Require a new evaluation before activating new weights.
- Motion scenes use metres, kilograms, seconds and newtons, with angles in degrees at the scene boundary. Y points up, the floor is y = 0, and a ramp descends along +X. A simulated value comes from the engine (source `rapier`). A theory value states its assumptions and its tolerance against the run. Report a failed theory check as found.
- `build_scene` validates an agent's request with the lab's code and returns a share link without simulating it. `simulate_scene` runs it and returns the plotted values. Agents quote numbers only from a result and never draw a curve the result does not contain.
- `predict_stress` returns a field, source, timing, and uncertainty or a reason for fallback. `verify_with_solver` solves the identical case and can report the discrepancy against a prediction. `optimize` searches only the caller's bounded geometry variables and reports the objective and constraints. FEM-check the baseline and selected candidate before presenting a verified improvement.

## Development commands

Run commands from the repository root. Use uv with Python 3.11 and pnpm with the Node and package-manager versions in the root manifests. Update a manifest and its lockfile in the same change once lockfiles are established.

- `make setup` installs all dependency groups and Git hooks.
- `make gen-data`, `make train`, `make export`, and `make mcp` are reserved entry points and accept `ARGS="..."`.
- `make web` starts the browser dev server. `pnpm --filter @physix/web run build` checks TypeScript and builds the static bundle.
- `pnpm --filter @physix/web run lab --preset pulley 60` runs a Motion scene headlessly and prints JSON measurements.
- `pnpm run build` builds the hosted site and Worker into `dist/`. `node --test mcp/sites/worker.test.mjs` tests the Worker's tools.
- `make test` runs pytest and Vitest. Put Python tests in `tests/` by subsystem and web tests beside the code they cover.
- `make lint` runs Ruff, ESLint, and Prettier checks. Use `uv run --no-sync pre-commit run --all-files` to exercise the hooks.
- CI runs setup, lint, tests, and a production web build on Linux. Run the focused tests for the change before the full checks.

## Testing and evidence

Every production module gets tests in the same change. Test normal inputs, invalid inputs at public boundaries, and regressions in each changed behavior. Keep the default suite CPU-friendly and deterministic. Generate tiny fixtures in tests or commit small versioned fixtures with provenance. Keep training runs, benchmarks, and large datasets out of the default test suite.

1. **Physics.** Test geometry limits and tags, analytic or manufactured cases, reactions and equilibrium, load scaling, and mesh refinement. Define the convergence tolerance and metric before treating a solve as a reference.
2. **Data.** Test seeded case generation, manifest reproducibility, parameter-family split isolation, raster orientation and units, and mask alignment.
3. **Model.** Test shapes, masks, normalization, ensemble statistics, out-of-domain handling, fallback calibration behavior, and ONNX parity on a small exported fixture.
4. **MCP and active learning.** Test tool schemas and provenance, deterministic fallback, solver failures, optimization constraints, and idempotent label intake. Include a local integration case with a real solver and a controllable predictor.
5. **Web.** Test tensor encoding against shared fixtures, inference and UI error states, consistent colors and units, and timing labels and sources.
6. **Motion.** Test each part against a closed-form result with a stated tolerance: energy and momentum where they are conserved, periods, accelerations and rebound speeds. Round-trip every template through `parseScene`, and reject bad agent requests with a named field. Quote the tolerance a test enforces in `docs/CONTRACTS.md`.
7. **Browser check.** For a visible change, run the dev server and exercise the change in the lab before handing off. Check the plot, the inspector and the console, not only the tests.

The scikit-fem result for the identical case and documented mesh is the source of truth for model accuracy. Never claim accuracy without a solver comparison. Compare matched cases, use the same masks and units, and report held-out split, dataset and model versions, mesh settings, error metrics, and sample counts. Use a defined hotspot metric and handling of mesh-sensitive stress singularities. Treat performance as a separate measurement. Record hardware, mesh and grid sizes, timing boundaries, and cold versus warm runs. Compare end-to-end timings for the same case and disclose any cached result.

## Parallel agent work

Agree on the case schema, units, geometry tags, field layout, masks, and artifact boundaries before dependent changes start. Assign each agent a directory or a short list of files and give each an isolated branch or worktree. Make shared files and lockfile changes the integration owner's responsibility.

| Workstream | Files | Dependency |
| --- | --- | --- |
| Physics and data | `physics/`, `data/`, corresponding tests | Starts first. Delivers a validated solver case, fixtures, and dataset contract. |
| Model and export | `model/`, corresponding tests | Can prepare model interfaces from fixtures. Training and calibration wait for solver-labeled data. |
| MCP and skill | `mcp/`, `skills/`, corresponding tests | Can develop against agreed contracts. End-to-end fallback needs the solver, and prediction needs the model bundle. |
| Browser and demo | `web/`, `docs/DEMO.md` | Can build against a shared fixture. Live inference and comparisons need exported models and matched solver references. |
| Motion lab | `web/src/lab/`, its tests, `docs/CONTRACTS.md` scene sections | Owns the scene contract. A new part lands with its engine model, probes, theory, viewport mesh, inspector and agent schema in one change. |
| Hosted plugin | `mcp/sites/`, `scripts/build_sites_worker.mjs`, `docs/CHATGPT.md` | Consumes the lab's scene builder. Changes to the scene contract land first. |
| Integration | Root tooling, shared schemas, lockfiles, and release evidence | Merges contract changes first, verifies each handoff and runs the full checks. |

In each handoff, provide the commit, changed interfaces, checks run, and known failures, and add a row to `docs/WORKLOG.md`. Update a shared fixture and its consumers together when a contract changes.
