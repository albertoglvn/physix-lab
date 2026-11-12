# Physix shared contracts

Every boundary in Physix exchanges versioned, SI-unit payloads. This page is the single
reference for the schemas that `physics/`, `data/`, `model/`, `mcp/` and `web/` share.
A change to any schema bumps its version string and updates the fixture and every
consumer in the same change.

| Contract | Version string | Owner | Fixture or source of truth |
| --- | --- | --- | --- |
| Case | `physix.case/1` | `physics/case.py` | `physics/examples.py` |
| Training domain | `physix.domain/1` | `data/domain.py` | `DOMAIN` |
| Raster and features | `physix.raster/1` | `data/raster.py` | `tests/fixtures/encoding_v1.json` |
| Dataset | `physix.dataset/1` | `data/generate.py` | `manifest.json` of each dataset |
| Active-learning label | `physix.label/1` | `data/labels.py` | label store records |
| Model bundle | `physix.model/1` | `model/export.py` | `manifest.json` of each bundle |
| Prediction response | `physix.prediction/1` | `mcp/physix_mcp/service.py` | `tests/mcp` |

## Units and coordinates

- SI everywhere: metres, pascals, newtons. Display units (mm, MPa, kN) are converted only in
  the browser and in human-readable summaries.
- Origin at the bottom-left corner of the part's bounding box, `x` to the right, `y` up.
- Stress tensor components are ordered `(σxx, σyy, τxy)`. Von Mises uses the plane-stress
  formula `sqrt(σxx² − σxx·σyy + σyy² + 3τxy²)` (`physics.solver.von_mises`).

## Case (`physix.case/1`)

```json
{
  "schema": "physix.case/1",
  "family": "plate",
  "geometry": {"width": 0.2, "height": 0.08, "holes": [{"x": 0.1, "y": 0.04, "radius": 0.012}]},
  "thickness": 0.005,
  "material": {"name": "steel", "young": 210e9, "poisson": 0.3},
  "support": "clamped",
  "load": {"kind": "traction", "x": 10e6, "y": 0.0}
}
```

- `family` is `plate` or `bracket`. Brackets add `web_width`, `flange_height` and
  `fillet_radius`; the web hangs from a clamped top edge and the load acts on the flange tip.
- Plates are clamped (or on rollers) on the left edge `x = 0` and loaded on the right edge
  `x = width`.
- `load.kind = "traction"` gives `x`, `y` in Pa on the load edge. `load.kind = "force"` gives
  the resultant in N, and `traction = force / (edge_length · thickness)`.
- An optional `analysis` block must match `linear_static` / `2` / `plane_stress` /
  `linear_elastic_isotropic`. Anything else is rejected with `unsupported_case`.
- `case_id` is a SHA-256 of the canonical JSON (excluding `meta` and the material label).
- Validation errors are `{"error": "invalid_case" | "unsupported_case", "message", "field"}`.

## Raster (`physix.raster/1`)

- Grid of `64 × 128` square pixels with `dx = width / 128`. The frame covers
  `x ∈ [0, width]` and `y ∈ [0, 0.5·width]`. Parts taller than half their width are outside
  the surrogate domain and are sent to the solver.
- Row 0 is the **top** row. Pixel `(i, j)` has its centre at
  `((j + 0.5)·dx, (63 − i + 0.5)·dx)`.
- Features, float32 `(7, 64, 128)`: `mask`, `sdf`, `x`, `y`, `support`, `load`, `poisson`. The
  formulas are in `data/raster.py`. `web/src/physics/encoding.ts` reimplements them and both
  are checked against the fixture to `1e-4`.
- Targets, float32 `(6, 64, 128)`: dimensionless stress per unit traction,
  `(σxx, σyy, τxy)` for a unit `x` traction and then for a unit `y` traction. Physical stress
  is `tx·T[0:3] + ty·T[3:6]`. Stress under a traction load doesn't depend on Young's modulus
  or thickness.
- The solid mask is explicit. Holes and outside pixels are zero in targets and excluded from
  losses, metrics and summaries.

## Dataset (`physix.dataset/1`)

A dataset directory holds `targets.npy`, `masks.npy`, `cases.jsonl` and `manifest.json`.
The manifest records the seed, sampling configuration and domain, the split fractions, the
solver version and mesh settings, the raster conventions, the counts of rejected and failed
cases, the pilot mesh-convergence reports and the solve timings with their host.

Splits are assigned per **group** (a base design and its jittered variants), so related
geometries never cross splits: `train` 70 %, `calibration` 15 %, `test` 15 %. A separate
`shifted` slice contains plates with holes larger than the training range, and it's used
only to evaluate out-of-domain behaviour.

## Model bundle (`physix.model/1`)

`model/exports/<model_id>/` and `web/public/models/` contain:

- `member_<k>.onnx` for `k = 0…4`. Input `features` `[B, 7, 64, 128]` float32, output
  `stress` `[B, 6, 64, 128]` float32, in the target units above. Normalization is baked
  into the graph, so callers pass raw features.
- `manifest.json` with the `model_id`, `dataset_id`, raster schema, domain, and the seed and
  SHA-256 of each member (ONNX file and source checkpoint). It also holds the fallback
  policy (metric, threshold, calibration coverage and error) and the held-out evaluation
  summary.

The ensemble prediction is the member mean. **Disagreement** is the member standard deviation
of the hotspot von Mises over the mean hotspot, all under the request's load. The fallback
policy is versioned with the bundle. Its threshold is calibrated on the calibration split
and never on the test split.

## Prediction response (`physix.prediction/1`)

`predict_stress` (MCP) and `POST /api/predict` (HTTP) return:

```json
{
  "schema": "physix.prediction/1",
  "source": "surrogate | fem | fem_fallback",
  "case_id": "case_…",
  "model": {"model_id": "…", "dataset_id": "…"},
  "summary": {"max_von_mises": 3.1e7, "hotspot": {"von_mises": 3.1e7, "x": 0.1, "y": 0.052},
              "stress_concentration": 3.1, "safety_factor": 8.1, "yield_strength": 2.5e8},
  "uncertainty": {"disagreement": 0.012, "threshold": 0.05, "domain": {"in_domain": true, "reasons": []}},
  "fallback": {"used": false, "reason": null},
  "field": {"frame": {"rows": 64, "cols": 128, "dx": 0.0015625, "row_order": "top_to_bottom"},
            "components": ["sxx", "syy", "txy", "von_mises"], "encoding": "base64-float32-le",
            "data": "…"},
  "timing": {"total_ms": 4.1, "stages": {"encode_ms": 0.6, "inference_ms": 3.5},
             "boundary": "server-side, excludes transport"}
}
```

`field` is omitted unless the caller requests it. A FEM-sourced response adds `solver`
(name, version, mesh preset and node count) and keeps the same summary keys. Model
disagreement and solver discretisation error are reported separately and never combined.

## HTTP API (local service, `127.0.0.1:8765`)

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /api/health` | | `{status, model_id, model_error, solver}` |
| `GET /api/model` | | Model bundle manifest (evaluation and policy) or `{available: false}` |
| `GET /api/domain` | | Case schema summary, materials, surrogate domain and examples |
| `GET /api/examples` | | Named example cases |
| `POST /api/predict` | `{case, include_field?, force_fem?, include_mesh?}` | Prediction response |
| `POST /api/verify` | `{case, prediction?, include_field?, include_mesh?}` | FEM response plus `discrepancy` |
| `POST /api/optimize` | `{case, variables, objective?, constraints?, budget?, seed?}` | `physix.optimize/1` report |

Validation errors return HTTP 422, solver failures 500, and unknown routes 404. Every
response is strict JSON, with non-finite numbers sent as `null`. CORS is allowed only for
loopback origins, and the server refuses to bind to anything but loopback.

With `--static <dir>` (`make demo`), the API also serves a built web app from the same
origin. Static responses carry `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, so the page is cross-origin isolated and
onnxruntime-web can use WASM threads. Paths that resolve outside the directory, and unknown
paths, receive `index.html`. The Vite dev and preview servers send the same headers and
proxy `/api` to this service.

### Browser bundle

The web app loads `models/manifest.json` and the five `member_<k>.onnx` files relative to the
page. It checks the raster schema, channel order and each member's SHA-256 before creating a
session, and applies the bundle's `domain` and `fallback_policy` with the same rules as
`mcp/physix_mcp/service.py`. `tests/fixtures/encoding_v1.json` and `postprocess_v1.json` pin
the encoder and the ensemble statistics on both sides.

`include_mesh` adds the reference mesh as base64 little-endian arrays: `points` float32
`(n, 2)` in m, `triangles` int32 `(m, 3)`, and nodal-averaged `von_mises` float32 `(n,)` in Pa.

### Optimization report (`physix.optimize/1`)

`variables` are `{path, min, max}` with paths `geometry.{width,height,web_width,
flange_height,fillet_radius}` or `geometry.holes[i].{x,y,radius}`. The response holds
`baseline` and `selected` designs, each with the screening `estimate` and an FEM block
(`fem`) on the service mesh preset, plus `candidates_verified`, `improvement`
(`relative_change` of the FEM objective), `verified_improvement` and the seeded `search`
trace. `verified_improvement` is true only when the selected design is FEM-feasible and
FEM-better than the FEM baseline.

MCP tools use the same service functions and return the same JSON.
