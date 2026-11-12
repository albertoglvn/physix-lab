# Physics reference

This document defines the reference solver that every model accuracy claim is measured against.

## Scope

Small-strain, static, isotropic linear elasticity in 2D plane stress with constant thickness. The solver supports two part families (`physics/case.py`):

| Family | Outline | Support | Load edge |
| --- | --- | --- | --- |
| `plate` | Rectangle `[0, width] x [0, height]` | Left edge `x = 0`, `clamped` or `roller` | Right edge `x = width` |
| `bracket` | L-shape: web `[0, web_width] x [0, height]`, flange `[0, width] x [0, flange_height]`, concave fillet of `fillet_radius` | Top of the web `y = height`, `clamped` | Flange tip `x = width, 0 <= y <= flange_height` |

Both families accept up to six circular holes. A request for 3D, shell bending, dynamics, buckling, contact, fracture, plasticity, large deformation or nonlinear material behaviour raises `UnsupportedCaseError` with an explicit reason (`analysis` block). So does a thickness above 0.25 x the smallest in-plane dimension, where plane stress is no longer a reasonable assumption.

## Conventions

- SI units: metres, pascals, newtons. The origin is the lower-left corner of the bounding box, `x` to the right, `y` upwards.
- Loads are a uniform traction `(x, y)` in Pa on the load edge, or a resultant force in N. A force converts to traction with `t = F / (load_edge_length x thickness)`. The case keeps the thickness used for the conversion.
- Stress components are `sxx`, `syy`, `txy` (Pa). Von Mises is the plane-stress form `sqrt(sxx^2 - sxx syy + syy^2 + 3 txy^2)` in `physics.solver.von_mises`.
- `clamped` fixes both displacement components on the support edge. `roller` fixes the normal component on the support edge and pins one node in `y`. Roller support makes uniform tension an exact analytic case.
- Under traction loading with zero prescribed displacements, the stress field does not depend on Young's modulus or thickness, and it scales linearly with the load. The solver uses this: it factorises once and solves for unit tractions in `x` and `y`, then combines them.

## Geometry validation

- Hole radius at least 0.004 x width.
- Clearance of at least 0.01 x width from every hole to the outer outline and between holes (ligament check uses exact Euclidean distance).
- Bracket `web_width` within [0.05, 0.8] x width, `flange_height` within [0.05, 0.8] x height, and `fillet_radius` within [0, 0.5 x min(width - web_width, height - flange_height)].

## Mesh and discretisation

`physics/mesh.py` builds a deterministic, boundary-conforming triangle mesh (DistMesh-style relaxation with fixed boundary nodes). Every boundary segment carries a tag: `support`, `load`, `free`, `fillet` or `hole<i>`. The solver uses quadratic (P2) Lagrange displacement elements. Stress is recovered exactly at element vertices (it is linear per element), giving a discontinuous piecewise-linear field.

| Preset | `h_max` | `h_min` | Points per full hole | Use |
| --- | --- | --- | --- | --- |
| `fast` | width / 28 | width / 120 | 40 | Interactive previews, fallback solves |
| `reference` | width / 40 | width / 200 | 64 | Dataset labels and verification |
| `fine` | width / 64 | width / 320 | 104 | Convergence checks |

## Hotspot metric

The hotspot is the maximum von Mises stress over the solid, excluding a band of 0.05 x width next to the support edge. The support corners carry a stress singularity whose peak grows with mesh refinement, so a peak there is not a meaningful engineering value. The stress concentration factor is the hotspot divided by the applied traction magnitude.

## Reference tolerance

A solve qualifies as a reference when, compared with a mesh refined by a factor of 1.6 (`physics.convergence.check_convergence`):

- the hotspot changes by at most 2 %, and
- the relative L2 change of von Mises stress on a regular probe grid inside the solid (excluding 0.02 x width next to every boundary) is at most 2 %.

Measured on the canonical examples (`physics/examples.py`) against a very fine solve (`h_max = width / 120`, `h_min = width / 500`) on a Windows desktop CPU:

| Case | Preset | Nodes | Field rel. L2 | Hotspot rel. | Wall time |
| --- | --- | --- | --- | --- | --- |
| Plate | fast | 606 | 0.37 % | 0.72 % | 0.5 s |
| Plate | reference | 1065 | 0.25 % | 0.20 % | 1.0 s |
| Bracket | fast | 528 | 0.92 % | 0.74 % | 0.5 s |
| Bracket | reference | 900 | 0.43 % | 0.84 % | 1.0 s |

Wall time includes meshing, which dominates. These numbers are a one-off measurement for orientation, not a benchmark.

## Dataset pilot

Before labelling, `data/generate.py` repeats the convergence check on 12 seeded pilot cases on the
`reference` preset and records the result in the dataset manifest (`pilot_convergence`). For
`physix-ds-v1`, 11 of 12 cases met both tolerances. One plate (`case_9359ba6189320cc2`, 1,094
coarse and 2,523 fine nodes) changed its hotspot by 2.23 % against the 2 % tolerance, while its
field changed by 0.21 %. Hotspot labels near tight ligaments therefore carry roughly 2 % of mesh
uncertainty. This is reported with the dataset and is not hidden by the fallback policy.

## Grid and mesh hotspots

The surrogate is trained on stresses sampled on the 64 x 128 raster (`physix.raster/1`), so its
hotspot is a grid hotspot. A peak concentrated in a thin band at a hole edge falls partly
between pixel centres. On the canonical plate, the grid hotspot is 30.9 MPa and the mesh hotspot
is 33.9 MPa. Model error is always measured grid against grid. `verify_with_solver` reports
both, and engineering checks should use the mesh value.

## Analytic checks

`tests/physics/test_solver.py` covers:

- Uniform tension with roller support: `sxx = T` and the end displacement `T L / E` to 1e-8 relative.
- Kirsch hole with d/W = 0.1: gross stress concentration within 3 % of the Howland value 3.03.
- Cantilever bending: `sxx = M y / I` at mid-span within 1 % of the outer-fibre stress.
- Equilibrium: support reactions balance the applied force to 1e-8 relative.
- Linearity, superposition, and independence from Young's modulus and thickness.
- Mesh convergence of both canonical cases within the reference tolerance.
