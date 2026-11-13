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
| Share link | `physix.share/1` | `web/src/share.ts`, `mcp/sites/worker.mjs` | `share.test.ts`, `lab/shared.test.ts`, `worker.test.mjs` |
| Scene request | `physix.scene-request/1` | `web/src/lab/buildScene.ts` | `buildScene.test.ts`, `worker.test.mjs` |

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
| `POST /api/verify` | `{case, prediction?, include_field?, include_mesh?, mesh_preset?}` | FEM response plus `discrepancy` |
| `POST /api/convergence` | `{case, presets?, probes?}` | `physix.convergence/1` study |
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

### Mesh preset override

`mesh_preset` on `/api/verify` is one of `fast`, `reference` or `fine` and replaces the
service default for that solve only. The response's `solver.mesh_preset` names the mesh
used. An unknown name returns 422 with `field: "mesh_preset"`.

### Convergence study (`physix.convergence/1`)

The study solves the case on three distinct presets (default `fast`, `reference`, `fine`).
`probes` holds up to eight `{x, y}` points in metres, each strictly inside the solid.
`levels` run from coarse to fine, sorted by element size `h = sqrt(solid area / elements)`
in metres. Each level holds:

- `preset`, `nodes`, `elements` and `element_size`;
- `hotspot`: the service hotspot on the mesh basis, in Pa;
- `probes`: von Mises at each probe, in Pa;
- `solve_ms`;
- `to_finer`: the convergence report against the next finer level, with `hotspot_rel` and
  `field_rel_l2` (von Mises on a fixed grid of points inside the solid), or null on the
  finest level;
- `passes`.

A coarser level passes when both changes are within 2%. The finest level passes when its
hotspot GCI is within 2%. `promoted` is the finest passing level, or null.

`hotspot`, and each `probes` entry (with its `x` and `y`), follow Celik et al. (2008) for
three levels with unequal ratios. The fields are:

- `kind`: `monotonic`, `oscillatory`, `divergent` or `converged`.
- `order`: the observed order p, from fixed-point iteration; null when undefined.
- `order_used`: min(p, 2) for monotonic convergence; otherwise the formal order 2 of P2
  elements.
- `safety_factor`: 1.25 for monotonic convergence, else 3.
- `extrapolated`: the Richardson value in Pa for monotonic convergence (the fine value when
  `converged`), else null.
- `error_fine`: the relative change between the two finest levels.
- `gci_fine`: the relative fine-grid convergence index.
- `ratio_fine` and `ratio_coarse`: the refinement ratios r21 and r32.

The response adds `source: "fem"`, `case_id`, `solver`, the settings of each preset,
`hotspot_tolerance`, `field_tolerance`, `gci_safety_factor`, `hotspot_rule` and `timing`
(three solves and comparisons, excluding transport). Invalid presets or probes return 422,
and solver failures return 500. The browser worker serves the same route.
`tests/fixtures/convergence_v1.json` holds the study of the canonical plate with two probes,
with solve times zeroed. The service test checks its layout, and the web sheet renders it.

The lab's convergence sheet takes its probes at a quarter, half and three quarters along
the current line probe. It keeps only points more than 2% of the width inside the solid.
While the student keeps the promoted mesh adopted, it passes that mesh as `mesh_preset` to
FEM checks of the same case.

### Stress sweep (`physix.stress-sweep/1`)

A Stress sweep varies one variable from the optimizer's set, using its paths. It takes up
to 41 values in metres, evenly spaced with both ends included. Each point records its
source and its sweep value in metres:

- `surrogate`: the in-browser ensemble accepted the point.
- `fem_fallback`: the point was solved with a forced FEM predict. This happens when the
  ensemble rejected it (`out_of_domain`, `high_disagreement` or `non_finite_prediction`),
  when the part is taller than the model frame (`outside_frame`), or when no model is loaded
  (`model_unavailable`).
- `fem`: the student checked a screened point; the screen is kept.

A point whose geometry is invalid, or that needs FEM while the solver is offline, has no
value and gives the reason. FEM points use the solver's raster hotspot when the case fits
the frame, so they compare with the surrogate on the same mask. The surrogate error,
|surrogate − FEM| / FEM, is reported only over those raster-basis points. Ensemble
disagreement is drawn as a ±1σ whisker on surrogate points and is never combined with
solver error.

The CSV export starts with `#` lines for the schema, family, variable, point count, model
id and disagreement threshold, the hotspot rule and the source meanings. Its columns are
`point, x, x_unit, source, hotspot, hotspot_x, hotspot_y, basis, surrogate_hotspot,
disagreement, fem_hotspot, mesh_preset, unit, note`, with lengths in m and stresses in Pa.

## Motion scene (`physix.lab/2`)

`{version, name, gravity, floorFriction, airDensity, linearDrag, objects}`. `gravity` is in
m/s² (0 to 30) and acts along −y. The floor is the plane y = 0. `airDensity` (kg/m³, 0 to 5)
and `linearDrag` (N·s/m, 0 to 10) are optional and default to 0, a vacuum. At most 32
objects, each with a unique `id`, a `kind` and a placement `x`, `z` in metres. Angles are in
degrees and everything else is SI.

| Kind | Fields | Notes |
| --- | --- | --- |
| `block` | `y`, `size`, `mass`, `rotation`, `vx`, `vy`, surface | A cube. `y` is its centre height and `rotation` is about z. |
| `ball` | `y`, `radius`, `mass`, `vx`, `vy`, surface | A solid sphere (I = 2/5 m r²). |
| `cylinder` | `y`, `radius`, `length` (0.2 to 3 m), `mass`, `vx`, `vy`, surface | A solid cylinder lying with its axis along z, so it rolls along x (I = m r²/2 about the axis). |
| `ramp` | `length`, `width`, `angle`, `friction` | A fixed wedge rising towards −x. |
| `pulley` | `leftMass`, `rightMass`, `wheelMass` | An Atwood machine: two weights on an inextensible rope over a wheel. `wheelMass` (kg, 0 to 20) makes the wheel a uniform disc, I = M R²/2. It is optional and defaults to 0, a massless wheel. |
| `pendulum` | `pivotHeight`, `length`, `mass`, `bobRadius`, `angle`, `link`, `rodMass` | A solid bob hung from a pivot. The bob is released from rest at `angle` from straight down, positive anticlockwise seen from +z. `link` is `rod` (default), a rigid rod hinged about z that turns the bob with the swing, or `rope`, which only stops the bob going beyond `length`: it goes slack when the bob moves inwards, and the bob does not turn. `rodMass` (kg, 0 to 20, default 0) makes the rod uniform; a rope must have none. |
| `spring` | `anchorHeight`, `stiffness`, `damping`, `restLength`, `mass`, `size`, `offset` | A cube on a linear spring and viscous damper (N/m, N·s/m), moving along y only. It is released from rest `offset` metres above the hanging equilibrium. |

`vx` and `vy` are the initial velocity in m/s. `vy` is optional and defaults to 0, so a
launcher is any free body with both set. A body on a ramp starts at rest. A free body may
also carry `force: {x, y, start, end}`: a constant force in newtons (−500 to 500 per
component) held at its centre of mass from `start` up to `end` seconds (0 to 60, with
`end` after `start`). Each step applies the force averaged over the part of the step it
covers, so the impulse is (x, y)·(end − start) at any step. The surface fields of a free
body (block, ball or cylinder) are:

| Field | Meaning |
| --- | --- |
| `restitution` | Coefficient of restitution e, 0 to 1. Optional, default 0. |
| `friction` | The body's own Coulomb coefficient, 0 to 2. Optional; without it the surface's coefficient applies. |
| `material` | Optional label for a library entry: `wood`, `steel`, `rubber`, `ice` or `felt`. Choosing one copies its friction and restitution; the mass stays as set. |
| `dragCoefficient` | Quadratic drag coefficient C_d, 0 to 2. Optional; without it a ball takes 0.47, a block 1.05 and a cylinder 1.2. |

| Material | μ | e | Density (kg/m³, shown for reference) |
| --- | --- | --- | --- |
| Wood | 0.4 | 0.5 | 700 |
| Steel | 0.5 | 0.6 | 7850 |
| Rubber | 1 | 0.8 | 1100 |
| Ice | 0.03 | 0.1 | 917 |
| Felt | 0.3 | 0.05 | 300 |

Validation rejects a pendulum whose swing would reach the floor. It also rejects a spring
whose cube would reach the floor or the anchor at any point of the undamped swing.

A `physix.lab/1` scene holds only blocks, ramps and pulleys with the same fields, so it
migrates by its version alone (its pulleys get a massless wheel). A migrated scene has a new run identity, because the
identity hashes the scene.

Each contact pair has one Coulomb coefficient (static equals kinetic): the smaller of the
two parts' coefficients. A body without its own coefficient carries 2, the largest allowed
value, so the ramp's or floor's coefficient governs its contacts with them, and two such
bodies grip each other at 2. Restitution combines by the larger value; floors and ramps
have none, so a body's own e sets its rebound. The engine applies e to the normal
velocity at the start of the step: the ratio of rebound to impact speed equals e, though
the rebound height falls short of e² h by the contact's sink into the floor (about 2 cm
at 1/120 s). Scenes saved before restitution and per-body friction parse unchanged and
behave as before against the floor and ramps, but the parsed scene gains `vy` and
`restitution`, so its run identity changes. A pendulum's moment of inertia about the
pivot is m L² + 2/5 m r² + M L²/3 on a rod of mass M, and m L² on a rope. The rod's mass
is a collider-free mass at the rod's middle with the inertia M L²/12 of a thin rod, so
gravity acts on it with the lever M L/2. A rope is a Rapier rope joint between the pivot
and the bob's centre. Scenes saved before links parse unchanged as a massless rod, but the
parsed scene gains `link` and `rodMass`, so its run identity changes.
Air drag acts on free bodies only, at the centre, as F = −(b + c |v|) v with b =
`linearDrag` and c = ½ ρ C_d A. The frontal area A is π r² for a ball, s² for a block and
2 r L for a cylinder, whatever the body's orientation; drag adds no torque. Each step holds
the force that makes the engine's update match the exact solution of v′ = a − k v over the
step, with k = (b + c |v|)/m and |v| taken at the step's predicted midpoint, so a body's
terminal speed √(m g / c) is exact and its velocity follows the closed forms to about 10⁻⁶.
Positions keep the engine's first-order error. A body resting on the floor under linear
drag feels a small spurious lift of about m g k h / 2. Scenes saved before air and forces
parse unchanged; the parsed scene gains `airDensity` and `linearDrag`, so its run identity
changes.
Each spring force is held over one step. The elastic part is read at a lead position
y + h·v·(N−1)/(2N), with N = 8 solver substeps, and the damper at the mean of the step's
start and end velocities. Under these rules the undamped engine period matches 2π √(m/k),
and the pendulum period matches the exact elliptic-integral period within 10⁻⁶.

The pulley's frame (base plate 0.16 m high, upright and wheel of radius 0.58 m at 4 m) is
fixed colliders. Both weights (0.5 × 0.54 × 0.5 m) start with their centres at 1.8 m and
hang at x ± 0.58 m. The engine steps the rope as one system: while it is taut the weights
move with a = g (m₂ − m₁)/(m₁ + m₂ + M/2), integrated exactly. A slack rope lets each
weight fall freely while the wheel spins on. Landing on the base plate and meeting the
wheel are inelastic stops. A rope pulled tight again takes an inelastic jerk that
conserves momentum along the rope. The weights are kinematic Rapier bodies that follow
this model, so they push other parts but are not pushed back.

## Motion run (`physix.run/1`)

One headless run of a Motion scene. The browser builds it with `runProtocol`, and the live
view replays the same steps.

| Field | Meaning |
| --- | --- |
| `id` | `sha256:` of the canonical JSON (sorted keys) of `inputs`. Equal inputs give the same id. |
| `inputs` | `scene` (`physix.lab/2`), `protocol`, `timeStep` (s, at most 1/30, default 1/120) and `rate` (probe rate in Hz, default 60) |
| `engine` | `name` (`rapier3d-compat`), `version`, `solverIterations` and `reproducibility` (`"same build and browser engine"`) |
| `seed` | `null`. Motion runs are not stochastic yet. |
| `timing` | `wallMs` and its `boundary`: engine set-up, every step and probe sampling, without rendering |
| `quantities` | `{key, target, label, symbol, unit, source}`. `key` is `<target>.<name>`, `target` is a part id or `system`, and `source` is `rapier` or `derived` (`ideal-atwood` in runs recorded before the simulated pulley). |
| `series` | `t` (s) and one column per quantity key with the same length. Samples sit on the `1/rate` grid, plus a final sample at the stop. A missing value is `NaN` in memory and `null` in JSON. |
| `events` | `{type, target, t}` with `type` in `rest`, `leaves_ramp`, `floor_contact` (after the body has been clear of the floor), `bounce` (the step on which a body with e > 0 turns from falling to rising), `collision` (the striker of a head-on pair comes within touching distance of its partner) and `pulley_stop` (a weight lands on the base or meets the wheel), resolved to one time step |
| `stop` | `{reason: "event" \| "time", t, event?}` |

A protocol is `{stop, maxTime}`: `stop` is an event type or `"time"`, and `maxTime` lies
between 0.5 and 60 s. A run ends at the first matching event or at `maxTime`.

Block quantities are position, velocity, speed, acceleration, kinetic and potential
energy, and the contact `normal` and `friction` forces (N). Acceleration is a backward
finite difference of velocity over one sample, and the first sample repeats the second.
The contact force on a free body is measured from its momentum over the step before the
sample: F = m Δv/h + m g ŷ, less any applied force and drag. It is split along the mean
normal of the body's touching contact manifolds into `normal` (F·n̂) and `friction` (the
rest, |F − (F·n̂) n̂|). A body touching nothing records 0 normal force. The first sample
repeats the second, since no step precedes it. A pulley records rope `displacement` and `speed` (positive
when the right weight goes down), `acceleration` (change in rope speed over the latest
step), the mean rope force on each weight over the step (`tension` on the left,
`rightTension`, 0 while slack), both weight heights (`leftY`, `rightY`) and the wheel's
`wheelSpeed` at the rim. System quantities are total kinetic, potential and mechanical
energy and linear momentum. Potential energy is m g y from y = 0, for pulley weights too,
and the wheel's kinetic energy is M v_rim²/4. A ball's or cylinder's kinetic energy includes its rotation, using the cylinder's inertia about its current axis. A pendulum records `angle`
(rad, from straight down), `omega` (rad/s, the bob's swing rate about the pivot, so a
rope's bob has one too), bob position, speed, link `tension` and its energies. The
tension is the link's pull along the bob-to-pivot line, measured like a contact force from
the momentum of the bob and rod over the step before the sample, positive when taut and
near 0 while a rope is slack; its first sample repeats the second. A massive rod adds
M L²ω²/6 of kinetic energy, its weight at its middle to the potential energy, and M v/2 to
the momentum, with v the bob's velocity. A spring records `y`, `vy`, `displacement` from the hanging equilibrium,
`extension`, spring `force`, and gravitational and `elastic` energy (½ k e²). The system
potential energy includes the elastic energy.

## Share link (`physix.share/1`)

A share link opens the lab on one set-up, carried in the URL fragment so that no server
stores it and the payload never reaches the host:

- `#/lab?study=motion&scene=<payload>` holds a `physix.lab/2` scene.
- `#/lab?study=stress&case=<payload>` holds a `physix.case/1` case.

The payload is the UTF-8 JSON of the scene or case, compressed with raw deflate (RFC 1951,
`CompressionStream("deflate-raw")`) and written in unpadded base64url. It holds at most 8192
characters and inflates to at most 65536 bytes. The route keeps a payload only when it fits
that alphabet and length. The lab inflates it, then validates the scene with the scene
parser or the case with `parseCase` (`web/src/physics/parseCase.ts`). `parseCase` mirrors the
limits of `case_from_dict` and `validate_case`, runs the client geometry checks, and accepts
clamped parts only. A link that fails opens the default study with a notice. A link holds
the set-up only: runs, solves and results are recomputed when it opens.

**Copy share link** in either study's menu writes the link for the current scene or case.
The hosted `compare_stress` tool adds `share_url` to each result. The link points to the
`/` page of the same origin and opens that result's `case`, so a student can open in the lab
the exact case that a chat reports.

## Scene request (`physix.scene-request/1`)

A scene request describes a Motion problem by the values that matter and leaves the rest to
the lab's defaults. `buildScene` (`web/src/lab/buildScene.ts`) turns it into a validated
`physix.lab/2` scene, and the hosted `build_scene` tool calls it.

- `template` names a starting scene, default `blank`. `name`, `gravity`, `floorFriction`,
  `airDensity` and `linearDrag` override the template's values.
- `objects`, when given, replaces the template's parts. Each part needs a `kind` and may
  give an `id` (default `<kind>-<n>`) and any of that kind's numeric fields. Every field it
  leaves out takes the default of a newly added part in the lab.
- A block, ball or cylinder may also give:
  - `material`, which sets friction and restitution from the library and keeps the mass;
    explicit fields override it;
  - `launch: {speed, elevation}` in place of `vx` and `vy`;
  - `force: {x, y, start, end}`;
  - `on_ramp: {ramp, fraction}`, which places it at rest on the surface of a ramp in the
    same request, as the lab does. `fraction` runs from 0 at the top to 1 at the foot
    (default 0.23). The part must fit within the ramp's length and width, and must not
    also give `x`, `y`, `z`, `vx`, `vy`, `rotation` or `launch`.
- A pendulum may give `link`; a rope defaults to no rod mass.

Unknown fields are rejected. Each part is validated alone, so an error names it as
`objects[i]`, and then the whole scene is validated with `parseScene`. Errors are
`SceneRequestError` with a `field` path such as `objects[1].on_ramp.fraction`. The result
is `{scene, defaults}`, where `defaults` lists, for each part ID, the fields taken from
defaults.

`motionDomain()` describes the request for agents: conventions, templates, materials, and
each kind's fields with their units, limits and defaults. `sceneRequestSchema()` is the
JSON Schema of a request. A test checks both against the lab's part defaults.

### Hosted scene (`physix.hosted-scene/1`)

`build_scene` returns `{schema, source: "scene_builder", scene, defaults, share_url,
simulated: false, note}`. The scene is validated but not simulated. The lab simulates it in
the browser, with its graphs, when the link opens. An invalid request returns
`{error: "invalid_scene", message, field?}` with `isError`. `describe_domain` adds
`motion`, the output of `motionDomain()`, beside the stress domain.

## Experiment (`physix.experiment/1`)

`{schema, id, name, studies: {motion: {scene}}, probes, protocol, runs, units: {display}, sweep?}`.
`id` is `sha256:` of `{schema, scene, protocol}`, so re-exporting the same set-up keeps the
id. `runs` holds `physix.run/1` records. Importing an experiment restores the scene and
protocol, re-runs it and reports whether the stored run is reproduced bit for bit, within
tolerance or not, with the largest difference, and adds its runs to the run history.
Exporting writes the live run first, then the baseline and any runs compared with it.

## Run history

The lab keeps finished `physix.run/1` records in the browser's IndexedDB (database
`physix-lab`, object store `runs`), one record per experiment holding `[{run, savedAt,
pinned}]` newest first. `savedAt` is milliseconds since the epoch. The key is
`motion:<scene name>`, not the experiment `id`: the `id` hashes the scene and protocol,
so a history per `id` could only hold identical runs. A run joins the history when the live
run reaches its stop, when it is kept by hand, or when an experiment is imported; a run
already there moves to the front. The history keeps 30 runs, dropping the oldest unpinned
run first. At most one run is pinned as the baseline. Where IndexedDB is missing or
refuses a write, the history lives in memory for the session.

The dock overlays the baseline and the runs chosen for comparison on the live plot, up to
six series in all with the live run, in data-palette colours other than the live
series'. Each chip names how that run's inputs differ from the current scene, in the stored
run's values (`g 1.62`, `block-1 mass 3`, `with ball-2`, `Δt 1/240 s`).

"Re-run and check" repeats a stored run from its inputs and compares every sample of `t`
and every column. It reports *bit for bit* when all samples are identical, *within
tolerance* when no sample differs by more than 10⁻⁹ × max(1, |stored value|), and
*different* otherwise, including a different sample count, a sample that is missing in
only one run, and a different Rapier version, which it names.

`sweep` is optional: `{record, fit?}` with the last `physix.sweep/1` record and the fit made
on it. It does not change the experiment `id`. Importing shows the stored points without
re-running them and repeats the fit from its `model` and `expression`.

## Motion sweep (`physix.sweep/1`)

One variable of a Motion scene varied over a list of values, or two variables over every
pair on a grid, with one headless `physix.run/1` per point and one metric read from each
run. Repeats can add synthetic sensor noise, rerun each point from a perturbed initial
condition, or both. `spec.second`, `spec.perturbation`, `points[].x2` and
`points[].perturbed` are optional and appear only when used, so a one-variable sweep
written before grids existed parses and keeps its `id`.

| Field | Meaning |
| --- | --- |
| `id` | `sha256:` of the canonical JSON of `{schema, scene, spec}`. Equal designs share an id. |
| `scene` | The base scene (`physix.lab/2`) before any value is applied |
| `spec.variable` | `gravity`, `floorFriction`, `airDensity`, `linearDrag`, `<object id>.<field>` or `<object id>.force.<x, y, start or end>`, in the scene's own unit (degrees for angles, SI otherwise). A body's `dragCoefficient` is offered when the scene has air. |
| `spec.values` | At most 200 values inside the variable's limits |
| `spec.second` | Absent, or `{variable, values}`: a second, different variable on the same terms. Points are every pair, at most 400. Each axis is checked on its own; a pair the scene rejects (such as a pendulum longer than its pivot is high) is kept as a point with a `NaN` value and the reason as its `note`. |
| `spec.metric` | `{kind: "reference", id}` (the measured side of a closed-form reference), `{kind: "probe", key, stat}` with `stat` in `final`, `max`, `min` and `mean`, or `{kind: "stop_time"}` |
| `spec.noise` | `null`, or `{sigma, resolution}` in the metric's SI unit |
| `spec.perturbation` | Absent, or `{variable, sigma}`: an initial condition (a body's `y`, `vx` or `vy`, a pendulum's `angle` or a spring's `offset`) and a positive σ in that variable's unit |
| `spec.repeats`, `spec.seed` | Synthetic readings per point (1 to 20, at most 400 in all; 1 without noise or a perturbation) and an unsigned 32-bit seed |
| `spec.protocol`, `spec.timeStep` | The stop protocol and step every run uses |
| `points` | `{index, x, x2?, value, theory?, readings, perturbed?, runId, stop, wallMs, note?}` in index order. On a grid `index` is row-major, `i·n₂ + j` for the `i`th first value and `j`th second value. `value` is the clean simulated metric, `NaN` in memory and `null` in JSON when a run does not define it. `theory` is the closed-form value at the point. `perturbed` is `{inputs, values}`, the perturbed starting value and clean metric of each repeat. `note` says why a value is missing or which assumption the scene breaks. |
| `status` | `complete`, or `cancelled` with the points finished so far |
| `engine` | `name` (`rapier3d-compat`) and the `version` that ran the points |
| `timing` | `wallMs`, `runners`, `hardwareConcurrency` when the browser reports it, and the `boundary`: first dispatch to last point, including worker start-up and engine set-up in each worker |

Runs are deterministic for the same engine build, so repeats differ only by synthetic noise
or a synthetic perturbation. One sweep runs at most 400 simulations: one per point, plus one
per perturbed repeat.

- *Perturbation.* Repeat `r` of point `i` starts from `clamp(u + σ_u·z′, min, max)`, where `u`
  is the variable's value at the point, `min` and `max` are its limits, and `z′` is a
  Box–Muller normal draw from mulberry32 seeded by a hash of `(seed, i, r, 1)`. A start the
  scene rejects reads `NaN`.
- *Noise.* Reading `r` of point `i` is `round((y + σ·z) / resolution) · resolution`, where `z`
  is drawn as above from a hash of `(seed, i, r)` and `y` is the point's clean value, or the
  repeat's perturbed value when there is a perturbation. Without noise, a perturbed reading
  is the perturbed value itself.

Readings do not depend on worker count or completion order. Each noisy reading's standard
uncertainty is `sqrt(σ² + resolution²/12)`; a perturbation adds scatter that this does not
include.

### Sweep fit

`{model, expression, constants, weighting, sigma?, parameters, covariance, n, dof, r2,
chi2?, reducedChi2?, converged, bandCoverage, excluded?}`. `model` is `linear`, `quadratic`, `cubic`,
`power`, `exponential`, `incline`, `pendulum` (T = 2π √(x/g), fitting g), `spring`
(T = 2π √(x/k)) or `custom`. `parameters` are `{name, value, se}` with
`se` one standard error. With noise, the fit is weighted by the reading uncertainty over
every reading, and `chi2` is reported. With a perturbation and no noise, it is unweighted
over every reading. Without either, it is unweighted over the clean values, and the
standard errors are scaled by the residual variance. A grid is not fitted. Expressions may use `x`, the
named parameters, `g` (the scene's gravity), `pi` and `deg`. Plotted bands are
`bandCoverage` (2) standard errors of the fitted curve.
The `incline` model fits sliding values only. Values whose clean acceleration is below
10⁻³ m/s² (the block rests at or below the sliding angle) are left out and listed in
`excluded: {values, reason}`.

### Sweep CSV

One row per simulated value, synthetic reading and closed-form value:

```
point,x,x_unit,x2,x2_unit,repeat,input,value,unit,source
```

`source` is `simulated`, `perturbed`, `synthetic` or `theory`. `x2` and `x2_unit` are set
on a grid. `repeat` is set on perturbed and synthetic rows, and `input` holds that repeat's
perturbed starting value when there is a perturbation. With both noise and a perturbation,
`perturbed` rows hold each perturbed run's clean metric and `synthetic` rows the noisy
reading of it. `#` lines at the top give the schema and id, scene, engine, `time_step_s`,
variable, the second variable and grid size, metric, status, noise model with seed, the
perturbation, and the fit when there is one. A missing value is an empty cell.

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
