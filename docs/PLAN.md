# Physix v1 milestone plan

The critical path starts with solver-labeled data. Model fitting, calibration, ONNX export, and an evidence-backed demo all depend on it.

| Milestone | Deliverable | Exit criteria |
| --- | --- | --- |
| 0 · Harness | Workspace layout, pinned manifests, setup, checks, CI, hooks, and skill draft | Generate and commit both lockfiles from an online setup. Pass setup, empty suites, lint, and the web build. |
| 1 · Geometry and reference solve | One rectangular plate with one movable circular hole, a fixed edge, and a prescribed traction on the opposite edge. Add a no-hole baseline for solver checks. | Validate geometry and boundary tags, pass an analytical baseline and reaction balance, and document mesh refinement and reference tolerances. Freeze a first case contract and fixture. |
| 2 · Dataset generation | Deterministic parameter sampling, FEM labels, rasterization, solid masks, and versioned splits. Add brackets and additional holes after the one-hole pilot works. | Generate a small dataset end to end with `make gen-data`. Check finite fields and correct units, masks, tags, and sample IDs. Produce family-grouped train, calibration, and test splits and a versioned manifest. |
| 3 · Ensemble and calibration | Train five seeded U-Nets. Derive mean and disagreement per case, and calibrate fallback on the calibration split. | Publish held-out field and hotspot error, plus coverage and error at the selected fallback threshold. Check a separate shifted-geometry slice, record timing, and export five ONNX models with parity fixtures and metadata. |
| 4 · MCP and active learning | Implement `predict_stress`, `verify_with_solver`, and bounded `optimize`. Persist successful fallback cases with provenance and deduplication. | Exercise prediction, fallback, hard rejection, and a solver-verified optimization through MCP. Run one offline retraining cycle with new FEM labels and evaluate against the frozen test split before promoting a model. |
| 5 · Browser and demo | A slider-driven plate, a stress heatmap, an uncertainty state, and matched solver references and timings. Deploy static assets on a free public GitHub Pages site. | Run ONNX inference in the browser with the same encoding as Python, including parity checks. Record measured warm and cold latency, validate references against the exact slider cases, and rehearse the two-minute demo. |

## Data generation first

1. Write the plate case specification and a small analytic baseline. Define material, thickness, traction units, parameter bounds, and clearance constraints.
2. Implement geometry validation and meshing with stable facet tags. Recover stresses on a common coordinate convention. Test the solver before sampling the parameter domain.
3. Generate a deterministic pilot, including cases near the valid clearance limit. Report rejected geometries and failed solves. Inspect representative masks, units, field ranges, and convergence before increasing sample count.
4. Freeze versioned data and test splits. Assign related geometries to one split together to limit leakage. Keep active-learning samples out of the frozen test set.

## Release evidence

- Publish masked component and von Mises field errors and a defined hotspot error against identical scikit-fem cases. Include sample counts, mesh settings, and what the fallback threshold covers.
- Measure warm browser interaction and cold model load separately. Report Python and browser inference and FEM timing with hardware, workload, and timing boundaries. Treat milliseconds as a target until measured.
- Use archived FEM field and timing references in the static browser for exact matching cases. Live FEM verification and fallback run through the local MCP server.
