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
| Motion run | `physix.run/1` | `web/src/lab/motion/run.ts` | `run.test.ts` |
| Experiment | `physix.experiment/1` | `web/src/lab/state/experiment.ts` | `exports.test.ts` |
| Motion sweep | `physix.sweep/1` | `web/src/lab/motion/sweep.ts`, `sweepPool.ts` | `sweep.test.ts`, `sweepExport.test.ts` |
| Line probe | `physix.probe/1` | `physics/probe.py`, `web/src/lab/stress/probe.ts` | `tests/fixtures/line_probe_v1.json` |

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
`(n, 2)` in m, `triangles` int32 `(m, 3)`, nodal-averaged `von_mises` float32 `(n,)` in Pa,
and `stress` float32 `(m, 3, 3)` in Pa: σxx, σyy and τxy at each element's three vertices,
in triangle order. `stress` is the exact linear stress of each element, so a point
evaluation needs no smoothing.

### Line probe (`physix.probe/1`)

A probe samples `n` evenly spaced points from `a` to `b`, both included (`n` = 201 in the
lab). On the FEM mesh a point takes the first triangle, in index order, whose barycentric
coordinates are all at least −10⁻⁹, and interpolates that element's vertex stress. On the
surrogate grid a point blends its four neighbouring pixel centres bilinearly, using solid
pixels only and renormalising the weights. Points outside the part or inside a hole are
undefined. Von Mises comes from the components with the shared plane-stress formula.

A section resultant is `t ∫ σ·n ds` over 1001 points, with `n` the unit normal of the line
oriented towards the load edge. The trapezoid rule skips intervals with an undefined end.
It is reported only when the line cuts the part into a supported side and a loaded side.

`tests/fixtures/line_probe_v1.json` stores the canonical plate, its float32 mesh payload
and two probes (the net section and an oblique line through the hole) with their values
and section resultants. Python and TypeScript must reproduce every value within 10⁻⁶ of the
probe's peak von Mises and every resultant within 10⁻⁶ of the applied force.

### Optimization report (`physix.optimize/1`)

`variables` are `{path, min, max}` with paths `geometry.{width,height,web_width,
flange_height,fillet_radius}` or `geometry.holes[i].{x,y,radius}`. The response holds
`baseline` and `selected` designs, each with the screening `estimate` and an FEM block
(`fem`) on the service mesh preset, plus `candidates_verified`, `improvement`
(`relative_change` of the FEM objective), `verified_improvement` and the seeded `search`
trace. `verified_improvement` is true only when the selected design is FEM-feasible and
FEM-better than the FEM baseline.

MCP tools use the same service functions and return the same JSON.

## Motion run (`physix.run/1`)

One headless run of a Motion scene. The browser builds it with `runProtocol`, and the live
view replays the same steps.

| Field | Meaning |
| --- | --- |
| `id` | `sha256:` of the canonical JSON (sorted keys) of `inputs`. Equal inputs give the same id. |
| `inputs` | `scene` (`physix.lab/1`), `protocol`, `timeStep` (s, at most 1/30, default 1/120) and `rate` (probe rate in Hz, default 60) |
| `engine` | `name` (`rapier3d-compat`), `version`, `solverIterations` and `reproducibility` (`"same build and browser engine"`) |
| `seed` | `null`. Motion runs are not stochastic yet. |
| `timing` | `wallMs` and its `boundary`: engine set-up, every step and probe sampling, without rendering |
| `quantities` | `{key, target, label, symbol, unit, source}`. `key` is `<target>.<name>`, `target` is a body id or `system`, and `source` is `rapier`, `derived` or `ideal-atwood`. |
| `series` | `t` (s) and one column per quantity key with the same length. Samples sit on the `1/rate` grid, plus a final sample at the stop. A missing value is `NaN` in memory and `null` in JSON. |
| `events` | `{type, target, t}` with `type` in `rest`, `leaves_ramp`, `floor_contact` and `pulley_stop`, resolved to one time step |
| `stop` | `{reason: "event" \| "time", t, event?}` |

A protocol is `{stop, maxTime}`: `stop` is an event type or `"time"`, and `maxTime` lies
between 0.5 and 60 s. A run ends at the first matching event or at `maxTime`.

Block quantities are position, velocity, speed, acceleration, kinetic and potential energy.
Acceleration is a backward finite difference of velocity over one sample, and the first
sample repeats the second. Pulley quantities come from the ideal Atwood model. System
quantities are total kinetic, potential and mechanical energy and linear momentum.
Block potential energy is m g y from y = 0. A pulley's potential energy is measured from its
starting position.

## Experiment (`physix.experiment/1`)

`{schema, id, name, studies: {motion: {scene}}, probes, protocol, runs, units: {display}, sweep?}`.
`id` is `sha256:` of `{schema, scene, protocol}`, so re-exporting the same set-up keeps the
id. `runs` holds `physix.run/1` records. Importing an experiment restores the scene and
protocol, re-runs it and reports whether the stored run is reproduced exactly, with the
largest difference.

`sweep` is optional: `{record, fit?}` with the last `physix.sweep/1` record and the fit made
on it. It does not change the experiment `id`. Importing shows the stored points without
re-running them and repeats the fit from its `model` and `expression`.

## Motion sweep (`physix.sweep/1`)

One variable of a Motion scene varied over a list of values, with one headless
`physix.run/1` per value and one metric read from each run.

| Field | Meaning |
| --- | --- |
| `id` | `sha256:` of the canonical JSON of `{schema, scene, spec}`. Equal designs share an id. |
| `scene` | The base scene (`physix.lab/1`) before any value is applied |
| `spec.variable` | `gravity`, `floorFriction` or `<object id>.<field>`, in the scene's own unit (degrees for angles, SI otherwise) |
| `spec.values` | At most 200 values inside the variable's limits |
| `spec.metric` | `{kind: "reference", id}` (the measured side of a closed-form reference), `{kind: "probe", key, stat}` with `stat` in `final`, `max`, `min` and `mean`, or `{kind: "stop_time"}` |
| `spec.noise` | `null`, or `{sigma, resolution}` in the metric's SI unit |
| `spec.repeats`, `spec.seed` | Synthetic readings per value (1 to 20, at most 400 in all; 1 without noise) and an unsigned 32-bit seed |
| `spec.protocol`, `spec.timeStep` | The stop protocol and step every run uses |
| `points` | `{index, x, value, theory?, readings, runId, stop, wallMs, note?}` in index order. `value` is the clean simulated metric, `NaN` in memory and `null` in JSON when a run does not define it. `theory` is the closed-form value at `x`. `note` says why a value is missing or which assumption the scene breaks. |
| `status` | `complete`, or `cancelled` with the points finished so far |
| `engine` | `name` (`rapier3d-compat`) and the `version` that ran the points |
| `timing` | `wallMs`, `runners`, `hardwareConcurrency` when the browser reports it, and the `boundary`: first dispatch to last point, including worker start-up and engine set-up in each worker |

Runs are deterministic for the same engine build, so repeats differ only by synthetic noise.
Reading `r` of point `i` is `round((value + σ·z) / resolution) · resolution`, where `z` is a
Box–Muller normal draw from mulberry32 seeded by a hash of `(seed, i, r)`. Readings do not
depend on worker count or completion order. Each reading's standard uncertainty is
`sqrt(σ² + resolution²/12)`.

### Sweep fit

`{model, expression, constants, weighting, sigma?, parameters, covariance, n, dof, r2,
chi2?, reducedChi2?, converged, bandCoverage, excluded?}`. `model` is `linear`, `quadratic`, `cubic`,
`power`, `exponential`, `incline` or `custom`. `parameters` are `{name, value, se}` with
`se` one standard error. With noise, the fit is weighted by the reading uncertainty over
every reading, and `chi2` is reported. Without noise, it is unweighted over the clean values,
and the standard errors are scaled by the residual variance. Expressions may use `x`, the
named parameters, `g` (the scene's gravity), `pi` and `deg`. Plotted bands are
`bandCoverage` (2) standard errors of the fitted curve.
The `incline` model fits sliding values only. Values whose clean acceleration is below
10⁻³ m/s² (the block rests at or below the sliding angle) are left out and listed in
`excluded: {values, reason}`.

### Sweep CSV

One row per simulated value, synthetic reading and closed-form value:

```
point,x,x_unit,repeat,value,unit,source
```

`source` is `simulated`, `synthetic` or `theory`, and `repeat` is set only on synthetic rows.
`#` lines at the top give the schema and id, scene, engine, `time_step_s`, variable, metric,
status, noise model with seed, and the fit when there is one. A missing value is an empty
cell.

### Samples CSV

The CSV export is a tidy long table, one row per sample and quantity:

```
run_id,t,quantity,value,unit,source
```

`#` lines at the top give each run's schema and id, scene, engine, `time_step_s`,
`probe_rate_hz`, stop event and the finite-difference note. Values are SI. A missing value
is an empty cell. Cells that contain a comma, quote or line break are quoted.

### Probe CSV

The stress probe export has one row per point and source:

```
source,s_m,x_m,y_m,sxx_pa,syy_pa,txy_pa,von_mises_pa
```

`source` is `surrogate` or `fem`. `#` lines at the top give `physix.probe/1`, the case
family and thickness, the model id, the solver and mesh preset, and each line's end points.
Points outside the solid have empty stress cells.
