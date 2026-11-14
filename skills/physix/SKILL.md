---
name: physix
description: Use the Physix MCP tools to estimate, verify, or optimize 2D linear-elastic stress fields in supported parametric plates and brackets with holes.
---

# Physix

Physix answers quick stress questions about thin plates and L-brackets with circular holes:
2D plane stress, static, small strain, isotropic linear elasticity. The tools are
`describe_domain`, `predict_stress`, `verify_with_solver` and `optimize`. If they aren't
listed, the server is not connected. Say so and point to `make mcp` in the project README.

## 1. Build the case

Call `describe_domain` once. It returns the `physix.case/1` schema, both example cases, the
material presets and the surrogate's training domain.

- Use SI units only. Lengths are in metres, stress and modulus in pascals, forces in newtons.
  Convert "200 mm" to `0.2` and "10 MPa" to `10e6` before calling a tool.
- A plate is supported on its left edge (`x = 0`) and loaded on its right edge. A bracket hangs
  from the clamped top of its web and is loaded on the flange tip. The origin is the
  bottom-left corner and `y` points up.
- `load.kind` is `traction` (Pa on the load edge) or `force` (resultant in N). The thickness
  converts between them, so keep the one the user gave.
- Use a named material (`steel`, `aluminium_6061`, ...) when the user names one. The safety
  factor is only reported for named materials.
- Ask for any missing input that changes the answer, such as a hole position, the load
  direction or the thickness when the load is a force. Don't guess these.

Out of scope: 3D, shell bending, dynamics, buckling, contact, fracture, plasticity, large
deformation and nonlinear materials. These requests come back as `unsupported_case`. Explain
why and don't approximate them with a 2D answer.

## 2. Predict

`predict_stress(case)` returns `source`:

- `surrogate`: a 5-model U-Net ensemble answered, because the case is inside the training
  domain and the ensemble disagreement is at or below the calibrated threshold. Report the
  disagreement and the threshold. The hotspot is on the 64×128 raster
  (`hotspot_basis: raster`). The raster smooths peaks, so a mesh solve can be somewhat
  higher at sharp notches.
- `fem_fallback`: the service solved the case with scikit-fem instead. Report the
  `fallback.reason` (`out_of_domain`, `high_disagreement`, `model_unavailable`, ...). The case
  is also queued for retraining. It's a solver result, so don't describe it as a model
  estimate.

Report the hotspot von Mises stress and its location, the stress concentration relative to
the nominal traction, and the indicative safety factor against the representative yield
strength. Present the safety factor as indicative, not as a design allowable. Convert to MPa
and mm only in the text you write.

## 3. Verify

Call `verify_with_solver(case, prediction)` when the user needs a solver-backed number or
before you rely on a surrogate answer for a decision. Pass the identical case and the
earlier prediction. The tool rejects a mismatched case with `case_mismatch`. Report
`discrepancy.prediction_hotspot_error`, the surrogate field errors (masked relative L2) and
the measured speedup, using their definitions. Model disagreement is not solver error, so
never present one as the other.

## 4. Optimize

`optimize(case, variables, objective, constraints, budget, seed)` changes only the geometry
paths you list, each within its bounds. For example:

```json
{"variables": [{"path": "geometry.holes[0].x", "min": 0.06, "max": 0.14}],
 "objective": "min_max_von_mises", "constraints": {"min_safety_factor": 2.0}}
```

The objective is `min_max_von_mises`, or `min_volume`, which needs a stress constraint.
Candidates are screened with the surrogate (or a coarse mesh when outside its domain). The
baseline and the best candidates are then re-solved with FEM. Claim an improvement only when
`verified_improvement` is true. Otherwise report what was found and that it isn't verified.
Always give the baseline value, the selected value and the relative change from the `fem`
blocks.

## Hosted Physix in ChatGPT or any MCP client

The hosted plugin offers `describe_domain`, `compare_stress`, `build_scene` and
`simulate_scene`. ChatGPT reaches them through the Physix plugin. Any other MCP client
reaches the same tools without a sign-in at
`https://physix-lab.hospitablepeacock.chatgpt.site/mcp/open`. Call
`describe_domain` first: it lists the stress domain and, under `motion`, the scene
conventions, templates, part kinds, fields, units, limits and defaults.

- `compare_stress` returns cached scikit-fem reference results for the example plate and
  L-bracket at the listed hole radii, scaled linearly by `load_multiplier`. The source is
  `fem_reference` or `fem_reference_scaled`.
- `build_scene` turns a mechanics problem into a lab scene. Pick the closest template or
  list the parts, and give only the values the problem states, in SI units and degrees.
  Use `on_ramp` to rest a body on a ramp and `launch` for a speed and an elevation. If it
  returns `invalid_scene`, fix the named `field` and call again. Tell the student which
  defaults the result lists when they matter, such as a block's size on a ramp. The scene
  is not simulated: do not quote results from it. The lab simulates it and draws its graphs
  when the link opens.
- `simulate_scene` runs the same request, or a scene from `build_scene`, with the lab's
  engine (source `rapier`) and returns its graphs' values. Use it when the student wants
  numbers, graphs or a check against theory. Quote numbers only from its `references`,
  `summary` and `events`, with their units. A theory value holds only under its
  `assumptions` and the result's `contact_model`. Report `within: false` or a `broken`
  reason as found rather than explaining it away, and say when `references_omitted` or
  `events_omitted` is not zero. To show a graph, plot its `series` entry in the same
  reply: `t` on the x axis in seconds, each column's `values` in the graph's `unit`, and
  `theory` dashed where given. Load the values from the result as they are rather than
  retyping them, and check a few plotted points against the result. Plot only values the
  result contains; never draw a curve from theory or endpoints alone and present it as
  the simulation. If it returns `invalid_run`, fix the named `field`. If it returns
  `engine_unavailable`, give the `share_url` so the lab runs the scene in the browser.

Every result carries a `share_url`. Give the student that link for each case or scene you
report, so they can open it in the Physix lab. Never edit a link or build one by hand.

## 5. Report

State the source, the model or solver version, and the timing boundary of every number.
Keep estimates, solver results and the discrepancy between them in separate sentences. If a
solve fails (`solver_failed`), report the message and suggest the geometric cause, such as a
hole too close to an edge or a very thin ligament.
