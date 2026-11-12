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

## 5. Report

State the source, the model or solver version, and the timing boundary of every number.
Keep estimates, solver results and the discrepancy between them in separate sentences. If a
solve fails (`solver_failed`), report the message and suggest the geometric cause, such as a
hole too close to an edge or a very thin ligament.
