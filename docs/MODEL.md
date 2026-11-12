# Model evaluation

This report is generated from the manifest of bundle `physix-unet5-2d0d9d4949`. Every error is
measured against the scikit-fem solution of the identical case on the dataset mesh preset,
rasterised to the same 64 x 128 grid with the same solid mask and units. The test and
shifted splits were never used for training, early stopping or threshold calibration.

## Provenance

| Item | Value |
| --- | --- |
| Model | `physix-unet5-2d0d9d4949` (`physix.model/1`) |
| Dataset | `physix-ds-f077ac30049fedfa`, 2159 solved cases |
| Solver labels | scikit-fem 12.0.2, `reference` preset, P2 elements |
| Architecture | name UNet, base 24, depth 3, parameters 1158774 |
| Training | 40 epochs, batch 16, lr 0.002, AdamW+OneCycle; 1294 fit rows, 180 validation rows |
| Loss | hotspot-weighted relative squared error per load direction |
| Members | 5, seeds 1000, 1001, 1002, 1003, 1004 |
| ONNX parity | max relative difference 3.2e-07 (tolerance 1e-04) |

Member files and SHA-256 hashes are listed in the manifest and on the model card (`#/model`).

## Held-out field and hotspot error

| Split | Cases | von Mises rel. L2 (median) | Component rel. L2 (median) | Hotspot error (median) | Hotspot error (p90) | Hotspot location error (median / p90) | Disagreement (median) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| calibration | 312 | 2.2 % | 2.8 % | 2.5 % | 11.8 % | 0.0 % / 19.5 % | 1.4 % |
| test | 292 | 2.2 % | 2.9 % | 2.5 % | 11.7 % | 0.0 % / 13.8 % | 1.5 % |
| shifted | 80 | 8.9 % | 10.0 % | 10.3 % | 25.1 % | 0.0 % / 23.5 % | 3.1 % |

Definitions:

- **hotspot**: max von Mises over solid pixels outside 0.05 x width of the support edge.
- **hotspot_error**: |surrogate - solver| / solver, both raster hotspots.
- **component_rel_l2**: masked relative L2 of (sxx, syy, txy).
- **von_mises_rel_l2**: masked relative L2 of von Mises.
- **raster_bias**: solver raster hotspot / solver mesh hotspot.
- **hotspot_location_error_rel**: distance between surrogate and solver hotspot pixels over the plate width. A median of 0 % means that in most cases the surrogate puts the hotspot in the same pixel as the solver.
- **disagreement**: member standard deviation of the hotspot von Mises over the mean hotspot.

By family on the test split:

| Family | Cases | von Mises rel. L2 (median) | Hotspot error (median) |
| --- | --- | --- | --- |
| Plate | 156 | 1.5 % | 1.5 % |
| Bracket | 136 | 3.7 % | 3.5 % |

Raster bias on the test split (solver grid hotspot over solver mesh hotspot): median 0.903,
p90 0.989. Grid hotspots therefore sit below mesh hotspots. FEM verification reports both;
see [PHYSICS.md](PHYSICS.md#grid-and-mesh-hotspots).

## Fallback policy

`physix.fallback/1`, metric: relative std of member hotspot von Mises under the request load. The threshold was chosen on the calibration split
so that the 90th percentile hotspot error of accepted cases stays at or below
10.0 %. Requires in-domain: true. Threshold: 0.0159.

| Split | Cases | Accepted (coverage) | Accepted hotspot error p90 | Accepted median | Fallback median |
| --- | --- | --- | --- | --- | --- |
| calibration | 312 | 177 (56.7 %) | 9.9 % | 1.2 % | 5.7 % |
| test | 292 | 152 (52.1 %) | 7.4 % | 1.6 % | 4.3 % |

Shifted split: 80 of 80 cases are outside the training domain and are routed to the solver (out-of-domain cases are always routed to the solver by the domain check).

## Timing

Python ONNX Runtime, warm, 20 repeats: median 175.0 ms, p90 226.3 ms.
Boundary: encode features + 5 ONNX members + ensemble statistics, batch 1, CPU. Host: Windows-10-10.0.26300-SP0, AMD64 Family 25 Model 116 Stepping 1, AuthenticAMD.
Cold load and browser timings are measured separately; the model card shows this browser's load time
and the Studio labels each field with its own inference time. These are single-machine measurements,
not a benchmark.

## Reading these numbers

- The surrogate is a screening tool. Use `verify_with_solver` before acting on a hotspot value, and
  `optimize` only reports an improvement after FEM checks of both the baseline and the selected design.
- Accepted predictions are those the policy would answer without the solver. Everything else is
  answered by FEM (`fem_fallback`) and stored as a label for the next training round.
- A new bundle must be re-evaluated with `make export` before it replaces this one.
