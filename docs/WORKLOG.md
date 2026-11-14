# Work log

This log records how Physix was built. v1 was built one workstream per branch, each merged into `main` with
`--no-ff` after its focused checks passed. Contracts were agreed first (see
[CONTRACTS.md](CONTRACTS.md)), so dependent work could proceed against fixtures.

## Workstreams

| Order | Branch | Scope | Key commits | Handoff |
| --- | --- | --- | --- | --- |
| 0 | `main` | Harness, pinned manifests, lockfiles, CI, hooks | `ee95774` | Setup, lint and empty suites pass |
| 1 | `feat/physics-reference-solver` | `physics/`, `tests/physics` | `440bcb2` | `physix.case/1`, tagged meshes, P2 solve, convergence check, canonical examples |
| 2 | `feat/data-pipeline` | `data/`, `tests/data` | `accf3b4` | `physix.raster/1`, `physix.domain/1`, `physix.dataset/1`, `physix.label/1`, encoding fixture |
| 3 | `feat/model-ensemble` | `model/`, `tests/model` | `42af6fe` | `physix.model/1` bundle, calibrated `physix.fallback/1`, ONNX parity |
| 4 | `feat/mcp-service` | `mcp/`, `skills/`, `tests/mcp` | `8f20cd0`, `1b1fd7a` | Four MCP tools, HTTP API, optimiser, post-processing fixture |
| 5 | `feat/web-studio` | `web/`, static serving | `5a62405`, `b976ac9`, `d0d1bb4`, `51a94b9` | TypeScript encoding parity, in-browser ensemble, Studio, landing page, model card |
| 6 | `docs/v1` | `README.md`, `docs/` | this branch | Current documentation, evaluation report |

Shared fixtures (`tests/fixtures/encoding_v1.json`, `postprocess_v1.json`) are the handoff
between Python and TypeScript. Vitest checks the browser encoder and the ensemble statistics
against them.

## Lab v2 (`feat/lab-v2-foundations`)

Lab v2 follows [LAB_PLAN.md](LAB_PLAN.md) on one branch, one commit per slice. Each slice
landed with its tests, its contract rows in [CONTRACTS.md](CONTRACTS.md) and a browser check
of the running lab.

| Slice | Scope | Key commits |
| --- | --- | --- |
| Phase 0 · Foundations | Mechanics lab, browser FEM worker, design tokens, panel primitives | `1971165`, `b5fa43e` |
| Phase 1 · One lab shell | Both studies in one shell at `#/lab` | `4089b19` |
| Phase 2 · Measurement and theory | Probes, plots, theory references, exports, stress line probes and Kt | `ea6ee29`, `7907254` |
| Phase 3 · New parts and variables | Sweeps and fits, ball, pendulum, spring, simulated pulley, materials, launcher, forces, drag, rods and ropes, run history, grids, stress sweeps and convergence | `e4078ff` to `dd1ca23` |
| Hosted ChatGPT plugin | Connect page, share links, `build_scene`, `simulate_scene` and plotted values | `39cf96b` to `cb42cf5` |
| Phase 3 follow-ups | Move arrows on the selected part, sprung Atwood machine, spring bumper and its ramp template, page review fixes, README opening with the live lab and the Codex workflow | `a17585f`, `e357725`, `58caec2` |
| Reviewer docs | Workflow board with the file shelf, Ship and Demo stops, README links and document ownership, published demo specs, and removal of three redundant `.gitkeep` files | `docs/reviewer-polish` |
| README demo | Published the 1080p60 video, linked poster and Codex workspace screenshot. Checked the media, README links and lint. | This change |

Checks at each slice: `vitest run`, `tsc --noEmit`, `eslint`, `prettier --check` and
`vite build` in `web/`, `node --test mcp/sites/worker.test.mjs` for the hosted Worker, and
the Python suite when `physics/` or `mcp/physix_mcp/` changed.

Release checks on 14 November 2026 passed with 465 web tests, 19 Worker tests and 131
Python tests. Web lint and the production build passed. Vite reported a large-chunk
warning, and the Python suite reported four ONNX exporter deprecation warnings.

## Checks at each merge

- `ruff check .` and `ruff format --check .`
- `pytest` for the changed subsystem, then the full suite before merging
- `vitest`, `eslint`, `prettier --check` and `vite build` for web changes
- Browser walkthrough of the served production build (`make demo`): model loading, live
  prediction, FEM verification, optimisation and model card, with no console errors

## Data and training runs

| Artifact | Identity | Notes |
| --- | --- | --- |
| Dataset | `physix-ds-v1` (`physix-ds-f077ac30049fedfa`) | 2,159 solved cases (train 1,474 · calibration 312 · test 292 · shifted 80), one failed solve, reference mesh preset, scikit-fem 12.0.2 |
| Ensemble | `physix-unet5-2d0d9d4949` | Five seeded members, 40 epochs, trained in parallel on CPU (about 97 min); ONNX parity 3.2e-07; held-out evaluation in [MODEL.md](MODEL.md) |

## Known limitations

- The pilot convergence study passed 11 of 12 cases. One plate exceeded the 2 % hotspot
  tolerance (2.23 %); see [PHYSICS.md](PHYSICS.md#dataset-pilot).
- The grid hotspot is sampled on the 64 × 128 raster and runs below the mesh hotspot (30.9 MPa against
  33.9 MPa, about 9 %, on the canonical plate). Surrogate hotspots are compared with grid references; FEM
  verification reports both.
- Training ran on a CPU. Timings in the model card are from that machine and are not a
  benchmark across hardware.
- Optimisation screens candidates with the surrogate when a bundle is loaded, and with the
  fast FEM preset otherwise. Only the baseline and the selected design are reported as
  verified.
- The public site runs on ChatGPT Sites, where browser FEM runs in a Pyodide worker. The
  local demo still serves the production build from the API so that FEM verification works
  from the same origin.
- Motion contacts use Rapier's solver. Impacts at the foot of a ramp lose the vertical
  component of the velocity, so a run's mechanical energy steps down there. The energy plot
  shows it rather than hiding it.
