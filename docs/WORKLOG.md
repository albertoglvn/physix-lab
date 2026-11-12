# Work log: first working version

This log records how v1 was built: one workstream per branch, each merged into `main` with
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
| Ensemble | see [MODEL.md](MODEL.md) | Five seeded members trained in parallel on CPU; held-out evaluation in the bundle manifest |

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
- Static hosting (GitHub Pages) is planned. The local demo serves the production build from
  the API so that FEM verification works from the same origin.
