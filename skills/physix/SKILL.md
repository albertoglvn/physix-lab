---
name: physix
description: Use the Physix MCP tools to estimate, verify, or optimize 2D linear-elastic stress fields in supported parametric plates and brackets with holes.
---

# Physix

Check which Physix tools are available before starting. If the server is missing, say that the tools are unavailable and point to the project's setup instructions. The scaffold lists the planned tool names.

1. Identify the geometry and hole parameters, thickness, material, boundary conditions, and load. Use the server's tool schema and supported domain. Convert inputs to the units declared in the schema. Ask for missing inputs that materially change the case.
2. Use `predict_stress` for a fast estimate. Report the source and uncertainty supplied by the service. If it returns `fem_fallback`, identify the field as a solver result and give the fallback reason when available.
3. Use `verify_with_solver` when the user needs an FEM comparison or a solver-backed result. Keep geometry, material, thickness, loads, and boundary conditions identical to the prediction case. Report discrepancy and timing with their definitions when the service provides them.
4. Use `optimize` when the user gives an objective and allowed geometry changes. Keep bounds and clearance constraints explicit. Report the baseline, proposed change, objective values, and solver verification status.
5. If a request falls outside the supported 2D linear-elastic domain or a solve fails, report the reason. Base accuracy and improvement claims on a matched solver comparison. Treat ensemble disagreement as an uncertainty signal.
