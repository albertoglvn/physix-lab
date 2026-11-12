# Physix two-minute demo

## Local setup

1. Generate data, train and publish a bundle (`make gen-data`, `make train`,
   `make export ARGS="--publish"`). The bundle lands in `model/exports/<model_id>/` and
   `web/public/models/`.
2. Run `make demo`. It builds `web/dist` and serves it with the API at
   <http://127.0.0.1:8765>, with cross-origin isolation, so the browser ensemble uses WASM
   threads and FEM verification is same-origin.
3. Open `#/studio` once before recording so the browser caches the members (warm path). Note
   the cold load time that the model card reports in "This browser".
4. For the agent segment, connect an MCP client to `make mcp` (config in the README). It loads
   the same bundle as the API, which the model card confirms with a "same model as the local API" badge.

## Script

**Before recording.** Open the browser demo and a local MCP client with the same model version. Prepare one in-domain plate, one valid case that crosses the calibrated uncertainty threshold, and a fixed-scale von Mises legend in MPa. Archive matching solver runs with case IDs and recorded timings. Preload the models for the warm slider segment and report the separate cold load time in the benchmark notes.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:15 | Open a plate with a circular hole, a clamped edge, and the load direction visible. | “Physix estimates where stress concentrates in this 2D plate while I change the design.” |
| 0:15–0:40 | Move the hole toward an edge, then change its radius. Keep the heatmap scale fixed and leave the geometry and legend in view. | “The model runs in this browser. Watch where the stress concentrates as the ligament gets narrower.” |
| 0:40–1:00 | Snap to a stored reference case. Show model and FEM heatmaps on the same scale, the measured error, and their timing labels. | “This is the same geometry, load, and material in both runs. Here is the error against scikit-fem and the measured time for each.” |
| 1:00–1:25 | Ask an agent to predict the second plate. Show the five-model disagreement and the `fem_fallback` response for the valid uncertain case. | “When the prediction crosses our uncertainty threshold, the agent gets a solver result. Physix saves that case and its solver label for a future training batch.” |
| 1:25–1:50 | Ask the agent to move the hole within specified bounds to reduce the chosen hotspot metric. Show baseline and proposed positions, clearance, and both FEM scores. | “The agent searched these bounds. The solver checked the original design and the selected change using the same load and stress metric.” |
| 1:50–2:00 | Return to the browser and show the demo URL or repository link. | “You can try the slider demo in your browser or use the MCP tools from an agent.” |

Only display measured values from the rehearsal runs. Label cached FEM results and their original solve times. Show a live FEM timing only when the solve completed. If a live call fails during recording, use a recorded run of the same case and label it as a recording.
