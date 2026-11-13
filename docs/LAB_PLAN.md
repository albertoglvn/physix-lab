# Physix Lab v2: one lab for research-grade experiments

This plan turns Physix from two adjacent tools (a 3D mechanics lab and a stress studio) into
one lab where a student or researcher designs an experiment, runs it, measures it, compares it
with theory, varies parameters, and exports evidence that holds up in a report or a paper. It
keeps the current pastoral visual style. [DESIGN.md](DESIGN.md) records the style rules, and
this plan cites it wherever the UI changes.

Status: in progress. Phases 0 to 3 are done; each phase lists its own status. Phase 4 has
not started. Ahead of it, the hosted ChatGPT plugin (`docs/CHATGPT.md`) runs
`simulate_scene` on the lab's engine and returns the plotted values for ChatGPT to chart; the
embedded chart view is off because ChatGPT does not open it for Sites-hosted plugins. The
plan started from the `web/src/lab/` workspace, `browser-fem` worker, `Home` page and `physix.lab/1`
scene contract.

---

## 1. Where Physix stands today

### 1.1 What already works

| Area | Capability | Source |
| --- | --- | --- |
| Mechanics | Rapier 3D rigid bodies at a fixed 120 Hz step. Blocks, ramps and ideal Atwood pulleys. Scene JSON import and export. Headless runner that prints JSON. | `web/src/lab/`, `web/scripts/run-lab.mjs` |
| Stress | Plane-stress plates and L-brackets with circular holes. scikit-fem reference solver with mesh presets and a convergence check. Five-member U-Net ensemble with calibrated FEM fallback. Bounded optimiser. | `physics/`, `model/`, `mcp/physix_mcp/` |
| Browser | ONNX ensemble in the tab, Pyodide FEM in a Web Worker, field and mesh views, model card. | `web/src/inference/`, `web/src/api/`, `web/src/ui/` |
| Agents | MCP tools `describe_domain`, `predict_stress`, `verify_with_solver`, `optimize`. | `mcp/physix_mcp/server.py` |
| Evidence | Versioned contracts, shared encoding fixtures, held-out evaluation, provenance on every stress answer. | `docs/CONTRACTS.md`, `docs/MODEL.md` |

### 1.2 What limits research use

**Experiment design**

1. The mechanics lab offers three object kinds. There are no spheres, springs, pendulums,
   joints, applied forces, drag or restitution, which rules out most first- and second-year
   mechanics experiments.
2. The pulley is an analytic Atwood model and does not interact with Rapier bodies. A student
   cannot place a pulley over a ramp or hang a block from it.
3. Initial conditions cover only `vx`. Projectiles, spin and 3D launches cannot be set.
4. Friction is a single coefficient per surface. The lab does not say that static and kinetic
   friction are the same in this model.

**Measurement**

5. Measurements are four instantaneous numbers for the selected object. There are no time
   series, plots, energy or momentum, contact forces, or data export.
6. There is no comparison with theory. A student cannot see how far the simulation is from
   `a = g(sin θ − μ cos θ)` or say whether the gap comes from the model or from the timestep.
7. There is no numerical check. The stress side has a mesh-convergence check, but the
   mechanics side has no timestep-convergence equivalent.

**Studying variables**

8. Each run is a single trial. Parameter sweeps, repeated trials, seeded noise and curve
   fitting are missing, and these are the core of a lab report.
9. Stress results cannot be sampled along a line. There is no stress-concentration factor
   against textbook formulas, no deformed shape, no reactions panel, and no export to
   ParaView or CSV.

**Workflow and UI**

10. The UI is split into a "Mechanics lab", a "Stress tools" area with three sub-tabs
    (Overview, Stress studio, Model card), Verify and Optimize panel tabs, and a separate
    marketing home. Users have to work out which page does what.
11. The lab uses a three-column page grid. The viewport is a card inside the page, not the
    workspace, so the scene competes with the panels for space.
12. There are two style systems. `styles.css` still defines the old dark tokens (`--bg:
    #0a0e1a`), `stress.css` overrides them with pastoral values, and `lab.css` uses a third set
    (`--lab-*`) plus many literal hex colours. `docs/DESIGN.md` did not exist before this plan.

---

## 2. Goals and principles

### 2.1 Outcomes

- **One lab.** Every experiment, whether motion or stress, happens at `#/lab` in one full-window
  viewport with floating controls. No page has more than one level of navigation.
- **Research-grade evidence.** Every number shows its source, units, uncertainty and the
  settings that produced it. Every run can be reproduced from its exported file.
- **Wider physics, honest limits.** Add the experiments students expect, such as pendulums,
  springs, collisions, projectiles, coupled pulleys, stress concentration and convergence.
  Name each model's assumptions where it is used, and reject out-of-scope requests clearly.
- **Data to the point.** Panels show values and controls, not prose. Explanations go in
  tooltips and in one methods summary that the user can export.

### 2.2 Design principles

1. **The viewport is the workspace.** Panels float over it, collapse to icons and never push it
   off-screen.
2. **Progressive disclosure.** Defaults run immediately. Probes, sweeps, fits and convergence
   studies appear only when the user asks for them.
3. **One experiment object.** Scene, probes, protocol and runs travel together in one file.
4. **Separate errors.** Keep numerical error (timestep, mesh), model error (ideal or analytic
   assumptions, surrogate disagreement) and measurement noise (seeded virtual sensors) apart,
   in both the UI and the data.
5. **Same engine everywhere.** The browser, the headless CLI and the agent tools run the same
   code and contracts. They differ only in transport.

### 2.3 Non-goals

- Leaving the AGENTS.md stress scope. Stress stays 2D, static, small-strain, isotropic
  linear elasticity. 3D stress, shells, buckling, contact stress, fracture, plasticity and
  dynamics in the stress study still return an explicit validation error.
- Soft bodies, fluids, optics or electromagnetism in v2. The architecture leaves room for new
  studies, but this plan does not add them.
- Accounts, cloud storage and collaboration servers. Experiments stay local files and browser
  storage.

---

## 3. The single lab

### 3.1 Routes

| Route | Becomes |
| --- | --- |
| `#/` | Home (marketing). Absorbs the content of the stress "Overview" (`Landing.tsx`). |
| `#/lab` | The only workspace. Query parameters select the starting state: `?study=motion&template=incline`, `?study=stress&example=bracket`, `?open=<file>`. |
| `#/lab/<preset>` | Redirect to `#/lab?study=motion&template=<preset>`. |
| `#/stress`, `#/studio/*`, `#/model` | Redirect to `#/lab?study=stress…`. The model card becomes a floating sheet, opened at `#/lab?study=stress&sheet=model`. |

Old links keep working. `WorkspaceHeader` and the `stress-navigation` bar are removed from
the lab, so the only way to leave it is the brand mark that leads home.

### 3.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ▣ Physix  Incline friction study ✎   [Motion|Stress]   ▶ ⏸ ⏭ ↺   ● ● ●   ⋯ │  top bar (48 px)
├───┬─────────────────────────────────────────────────────────┬───────────────┤
│ + │                                                         │ Inspector     │
│ ▤ │                                                         │ ───────────── │
│ ◎ │                full-window viewport                     │ block-1       │
│   │      (3D scene for Motion, 2D specimen for Stress)      │  Mass  2.00 kg│
│   │                                                         │  Size  1.00 m │
│   │   HUD: axes gizmo · scale bar · colour bar · hover      │  …            │
│   │        readout · provenance chip                        │ [Probe this]  │
│   │                                                         │               │
├───┴─────────────────────────────────────────────────────────┴───────────────┤
│ t 1.42 s · v 3.18 m/s · a 2.39 m/s² (theory 2.41, Δ 0.8 %)          ⌃ Data │  data dock (collapsed)
└─────────────────────────────────────────────────────────────────────────────┘
```

| Element | Content | Behaviour |
| --- | --- | --- |
| **Top bar** | Brand mark (home); editable experiment name; Study switch with two segments, Motion and Stress; transport (Run, Pause, Step, Reset); status dots for engine, solver and model with tooltips; overflow menu ⋯ (New, Open, Save, Export, Scene JSON, Model card, Shortcuts) | Always visible. This is the only place for global actions. |
| **Parts rail** (left) | Three icons: Add (parts flyout), Templates (starting experiments), Outline (object list with visibility and lock) | Flyouts float over the viewport and close on Escape or an outside click. The rail is 48 px wide. |
| **Inspector** (right) | Properties of the selection, or scene settings when nothing is selected. Collapsible groups: Geometry, Material, Initial state, Probes. | Floating card about 280 px wide that collapses to a tab on the edge. It never shows fields for objects that are not selected. |
| **Data dock** (bottom) | Collapsed: one line of live readings with theory deltas. Expanded: a plot area with Plot and Table icon toggles, run chips for comparison, and a Sweep or Fit strip when one is active. | Resizable from 32 px to 60 % of the window height. The expanded height is remembered for each viewer. |
| **Viewport HUD** | Axes gizmo, scale bar, colour bar (Stress), force and velocity vectors, hover readout, provenance chip | Anchored to the viewport corners. Each layer can be switched off from the View menu in the overflow. |
| **Sheets** | Model card, Methods summary, Sweep setup, Convergence study, Export | One modal sheet at a time, centred. Each closes back to the same lab state. |
| **Command palette** | Ctrl/⌘ K lists every action with its shortcut. | For power users. Every action in it is also reachable from the visible UI. |

The layout has no page tabs. The Verify and Optimize panel tabs become actions:

- **Verify with FEM** is a top-bar button in Stress. Its discrepancy appears in the data dock and
  as a difference-map layer in the viewport.
- **Optimize** opens a sheet for bounds and objective. Candidates stream into the dock table,
  and the selected design loads into the viewport.

### 3.3 One study switch, one experiment

The Study switch changes the solver and the viewport projection. The shell, the panels and the
experiment file stay the same.

| | Motion study | Stress study |
| --- | --- | --- |
| Viewport | 3D perspective, orbit, ground grid | 2D orthographic specimen, pan and zoom, field layers |
| Engine | Rapier (fixed step) plus analytic references | Surrogate ensemble, FEM fallback, scikit-fem reference |
| Run means | Time integration | Static solve (instant surrogate, FEM on demand) |
| Probes | Time series per object | Point, line and region samples of fields |
| Sweep axis | Any scalar input | Any bounded geometry, load or material input |

An experiment file can hold both studies, for example a bracket reaction measured in Motion
and then analysed in Stress (see §4.4). The switch keeps each study's state while the user
moves between them.

### 3.4 Interaction rules

- Selecting an object in the viewport or the Outline opens it in the Inspector. Hover shows a
  value tooltip. In Stress, hover shows σxx, σyy, τxy and von Mises at the cursor.
- Editing an input resets the run, and the dock shows a "Reset to apply" ghost state. Inputs
  never change silently during a run.
- Every numeric field accepts units. For example, `12 mm` converts to SI on blur, and the
  display unit follows the scene's unit preference (§5.6).
- Shortcuts: Space runs or pauses, `.` steps, `R` resets, `F` frames the selection, `Del`
  deletes, `P` probes the selection, Ctrl/⌘ Z and Shift Z undo and redo (new history stack),
  Ctrl/⌘ S saves.
- Errors appear as toasts at the top centre and in the affected field, never as a full page.
  Validation errors name the field, the limit and the unit.

---

## 4. Physics and toolset upgrades

### 4.1 Motion study (rigid-body mechanics)

**New parts** in scene contract `physix.lab/2`:

| Part | Parameters (SI) | Implementation |
| --- | --- | --- |
| Sphere, cylinder | radius, (length), mass, initial linear and angular velocity | Rapier ball and cylinder colliders. Enables rolling-without-slipping experiments. |
| Block (extended) | Adds `vy`, `vz`, angular velocity, per-body material | Existing body with a full initial-state vector |
| Spring | anchor A and B (body or world point), stiffness k, damping c, rest length | Rapier spring joint, or an explicit force pair applied each step |
| Rod or rope | length, attachment points, rigid or rope-limited | Rapier revolute or rope joint. Enables simple and compound pendulums. |
| Pulley (simulated) | wheel radius, inertia (optional), attached bodies | Rope constraint through the wheel, coupled to real bodies. The ideal Atwood formula stays as the theory reference. |
| Anchor or wall | position, orientation, material | Fixed collider |
| Applied force | target, vector, start and end time or impulse | Force applied before each step |
| Launcher | position, speed, elevation and azimuth | Sets initial velocity. Projectile template. |

**Environment**: gravity vector (not only magnitude), linear and quadratic air drag with a
drag coefficient and reference area, and a ground material.

**Materials**: a small library of named materials (wood, steel, rubber, ice, felt) with a
friction coefficient, restitution and density. Each per-body override is recorded in the
scene. The Inspector and the methods summary state the limitation that Rapier uses one
Coulomb coefficient for each contact pair, so static and kinetic friction are equal. Do not
fake a static/kinetic split until it can be validated against the analytic stick-slip
threshold.

**Probes and derived quantities**, sampled at a configurable rate (default 60 Hz, decimated
from the 120 Hz step):

- Position, velocity, acceleration (finite difference of velocity, labelled as such), angle and
  angular velocity
- Kinetic, potential, spring and total mechanical energy, work done by friction and drag
  (integrated), and an energy-balance residual
- Linear and angular momentum per body and for the whole system
- Contact normal and friction force from Rapier contact force events, plus spring extension
  and rope tension
- Events: first contact, separation, speed below ε, reaching a coordinate, and stopping at a
  pulley limit

**Stop conditions and protocols**: a run ends at a time limit, an event or a step limit. The
protocol is stored in the experiment so the headless runner reproduces the same trial.

**Theory overlays**: each template ships with closed-form references that are evaluated next
to the simulation and drawn as dashed curves in the dock.

| Template | Reference |
| --- | --- |
| Incline | a = g(sin θ − μ cos θ) for tan θ > μ, and at rest otherwise |
| Friction track | stopping distance v₀² / (2 μ g), stopping time v₀ / (μ g) |
| Atwood | a = g(m₂ − m₁)/(m₁ + m₂), T = 2 m₁ m₂ g/(m₁ + m₂) |
| Pendulum | small-angle period 2π√(L/g), plus the exact large-angle period from the elliptic integral |
| Spring–mass | ω₀ = √(k/m), damped response for a given c |
| Projectile | drag-free parabola, range and apex |
| Elastic collision | final velocities from momentum and energy conservation |
| Rolling | a = g sin θ / (1 + I/(m r²)) |

The dock shows the simulated value, the reference value and their difference (Δ) together.
When the scene leaves a reference's assumptions, for example a block that leaves the ramp,
the overlay is marked "assumption broken" with the reason.

**Timestep convergence**: the Motion counterpart of the mesh-convergence check. One action
re-runs the protocol at Δt, Δt/2 and Δt/4 and reports how the probed quantity changes, the
observed order of convergence, and whether the result passes a stated tolerance (default 1 %
on the probed quantity at the stop event). The run records the outcome.

**Determinism**: record the Rapier version, step size, solver iterations and the seed for
each run. Before Phase 2 ends, test whether the cross-platform deterministic Rapier build is
needed so that exported runs reproduce bit-for-bit across machines. Until then, document
reproducibility as "same build and same browser engine".

### 4.2 Stress study (2D linear elasticity)

All additions stay inside 2D, static, small-strain, isotropic linear elasticity.

**Toolset that uses the current solver as it is**

- **Line probes**: draw a segment, such as the ligament across a hole, and get σxx, σyy, τxy
  and von Mises along it from the surrogate grid or the FEM mesh. Line probes are the
  standard plot in stress-concentration studies.
- **Stress-concentration factor**: Kt = σmax / σnom with the nominal-stress definition shown,
  next to a reference: Kirsch (Kt = 3) for an infinite plate and Heywood's finite-width
  formula for a central hole. Show the difference and the hotspot-handling rule from
  AGENTS.md.
- **Displacement and deformation**: show the displacement magnitude and a deformed outline
  with a stated scale factor. This needs the displacement field from `physics/solver.py`,
  so the solver response carries it.
- **Reactions and equilibrium**: show the support reactions, the applied resultant and the
  residual, the same check the physics tests already make.
- **Safety factor**: yield strength from `YIELD_STRENGTH` (or user input) divided by the peak
  von Mises stress, shown with the hotspot caveat.
- **Convergence study sheet**: solve at coarse, medium and fine presets, plot the hotspot and
  probe values against element size, report Richardson extrapolation and the grid
  convergence index, and promote the finest mesh that passes as the run's reference.
- **Surrogate versus FEM**: show a difference map plus masked RMSE and hotspot error, with
  model disagreement kept separate from solver error.

**Wider cases, solved by FEM first and the surrogate later**

Requests that the solver supports but the surrogate does not are sent to FEM with source
`fem` and a stated reason. This widens the lab at once without overstating what the model
can do.

| Extension | Contract impact | Surrogate |
| --- | --- | --- |
| Plane strain option (thick sections) | `physix.case/2` adds `analysis: "plane_stress" \| "plane_strain"`. Von Mises gets the plane-strain σzz term, so the shared formula in CONTRACTS.md and `stats.ts` needs a variant. | FEM only until a dataset covers it |
| Multiple holes, slots and elliptical holes | New `holes[].shape` kind with clearance validation in `physics/geometry.py` | FEM only. Domain check rejects them for the surrogate. |
| Edge notches (U and V) with a root radius | Geometry kind | FEM only |
| Pin-loaded hole (bearing pressure as a cosine traction on the hole edge) | Load kind | FEM only |
| Multiple load edges and combined tension with shear | Load list | FEM, then a dataset extension |
| Symmetry and pinned supports | Support kinds | FEM |
| More materials | Material presets with references | Surrogate works if E and ν are inside the domain |

Each extension lands in `physics/` with analytic or manufactured-solution tests before it
reaches the UI, following the testing rules in AGENTS.md.

### 4.3 Shared research workflow

**Experiment file `physix.experiment/1`**

```jsonc
{
  "schema": "physix.experiment/1",
  "id": "sha256:…",              // hash of the canonical inputs
  "name": "μ from incline angle",
  "studies": {
    "motion": { "scene": { "version": "physix.lab/2", … } },
    "stress": { "case":  { "schema": "physix.case/2", … } }
  },
  "probes":   [{ "id": "a", "target": "block-1", "quantity": "acceleration.along_ramp", "rate": 60 }],
  "protocol": { "stop": { "event": "leaves_ramp", "max_time": 10 } },
  "sweep":    { "variable": "objects.ramp-1.angle", "values": { "from": 20, "to": 50, "step": 2 }, "repeats": 5, "seed": 7 },
  "noise":    { "a": { "sigma": 0.02, "resolution": 0.01 } },
  "runs":     [ /* physix.run/1 records */ ],
  "units":    { "display": "si" }
}
```

A `physix.run/1` record holds the input hash, engine and solver versions, step size or mesh
settings, seed, wall-clock timing boundaries, probe series (column-oriented and SI), events,
theory references with their assumptions, and convergence results when they were run.

**Parameter sweeps and repeated trials**

- Sweep one variable (a range or a list), or two variables on a grid capped at 400 runs in the
  browser. The sweep runs in a pool of Web Workers headlessly, so the viewport stays
  responsive. The dock shows progress and partial results.
- Repeats apply seeded perturbations to initial conditions and seeded virtual-sensor noise.
  Results are labelled "synthetic noise" so students can practise uncertainty analysis
  without confusing it with model error.
- The result metric is any probe statistic: the value at an event, maximum, mean, time to an
  event, or period from zero crossings.
- In Stress, sweeps use the surrogate to screen, then run FEM on chosen points or on any point
  where fallback triggers. Each point shows its source.

**Fitting**

- Models: linear, polynomial (degrees 2 and 3), power law, exponential, damped sinusoid, and
  a user expression with named parameters (safe expression parser, no `eval`).
- Least squares with a parameter covariance matrix, standard errors, R², reduced χ² when
  uncertainties exist, and a residual plot.
- The fit result goes back to the experiment. One example: fit `a(θ)` to recover μ with its
  uncertainty and compare it with the μ that was set.

**Run history and comparison**

- Runs persist in IndexedDB for each experiment ID. Any run can be pinned as a baseline. Run
  chips in the dock overlay series for comparison, up to six at once with distinct colours
  from the data palette in DESIGN.md.
- "Re-run and check" repeats a run and reports whether the results match within tolerance
  or bit-for-bit.

**Exports** (from the overflow menu, as one sheet)

| Export | Content |
| --- | --- |
| `experiment.physix.json` | The full experiment file, including runs |
| CSV (tidy, long form) | `run_id, t, quantity, value, unit, source` with a metadata header comment |
| Field data | Stress rasters as `.npz` or `.csv` with the mask. FEM meshes as `.vtu` for ParaView. |
| Figures | Plot as SVG and PNG, viewport as PNG with the scale bar and colour bar |
| Methods summary | Generated paragraph listing engine and solver versions, step or mesh, convergence result, model bundle ID and calibration, sweep design and seeds, noise model, and assumptions. Ready to paste into a report. |
| Citation | `CITATION.cff` at the repository root and a BibTeX entry in the export sheet |

**Headless and notebook use**

- Extend `run-lab.mjs` into a `physix-lab` CLI that runs an experiment file, including
  protocols and sweeps, and writes the run records and CSV.
- Add a small Python helper in `scripts/` that loads exported CSV and run records into
  pandas-ready structures. It only reads files and does not reimplement Rapier.
- The stress side already has a Python API. Add `physics.probes` for line sampling, Kt and
  reactions, so notebooks get the same numbers as the lab.

### 4.4 Cross-study link (Phase 4)

A quasi-static bridge: take a measured support or contact reaction from a Motion run, such as
the peak force at a bracket's anchor during an impact, and create a Stress case with that
resultant force on the matching edge. The UI and the methods summary state the
assumption that the dynamic peak is applied as a static load, with no inertia or wave effects.
This stays inside the stress scope and lets students follow one experiment from motion to
stress.

### 4.5 Agent tools

| Tool | Change |
| --- | --- |
| `describe_domain` | Report both studies, the supported parts and loads, and FEM-only extensions |
| `simulate_scene` (new) | Run a `physix.lab/2` experiment through the Node runner in a subprocess and return run records. Logs go to stderr. |
| `sweep` (new) | Bounded sweeps for either study, capped in size, with per-point sources |
| `probe_field` (new) | Line, point and Kt sampling on a predicted or verified field |
| `predict_stress`, `verify_with_solver`, `optimize` | Accept `physix.case/2`. Return displacement and reactions when requested. |

`skills/physix/SKILL.md` is updated with when to use each tool and how to read noise, theory
deltas and convergence results.

---

## 5. UI build plan

### 5.1 Component structure (`web/src/lab/`)

```
lab/
  LabShell.tsx            top bar, rails, dock and sheet host; owns layout state
  state/
    experiment.ts         experiment reducer, undo/redo, persistence
    runs.ts               run store (IndexedDB), comparison selection
  motion/
    scene.ts              physix.lab/2 contract, migration from /1
    simulation.ts         Rapier world, joints, forces, probes, events
    theory.ts             analytic references with their assumptions
    MotionViewport.tsx    three.js scene (grows out of LabViewport.tsx)
  stress/
    StressViewport.tsx    2D field canvas (reuses FieldView, MeshView)
    stressStudy.ts        surrogate, FEM, verify, optimize orchestration
  data/
    probes.ts, sweep.ts, fit.ts, noise.ts, exportCsv.ts, methods.ts
    DataDock.tsx, Plot.tsx (lightweight SVG/canvas plot, no heavy chart library)
  panels/
    PartsRail.tsx, Inspector.tsx, Outline.tsx, Templates.tsx
  sheets/
    ModelCardSheet.tsx, SweepSheet.tsx, ConvergenceSheet.tsx, ExportSheet.tsx, MethodsSheet.tsx
  ui/
    FloatingPanel.tsx, Dock.tsx, Toast.tsx, CommandPalette.tsx, UnitInput.tsx, Readout.tsx
```

`pages/Studio.tsx`, `pages/StressApp.tsx`, `pages/Landing.tsx`, `pages/ModelCard.tsx` and
`studio/*Panel.tsx` are dismantled into the modules above, so their logic is reused rather
than rewritten. `WorkspaceHeader` is deleted after the redirects land.

### 5.2 Plotting

Use a small in-house plot component (SVG axes plus a canvas for dense series) that reads the
tokens from DESIGN.md, supports linked hover with the viewport, log axes, error bars and
shaded fit bands. This avoids a large dependency and keeps the style consistent. If the
in-house plot needs more than two weeks of work, fall back to `uplot` as a measured
alternative.

### 5.3 Floating panel system

- `FloatingPanel` has docked anchors (left, right, bottom) and a collapsed state. It does not
  support free dragging in v2, which keeps layouts predictable and testable.
- Panels use the elevated surface tokens from DESIGN.md: daylight background, a 1 px edge, a
  soft shadow and a 16 px radius.
- Panel state (collapsed or open, dock height) persists in `localStorage` per viewer inside a
  try/catch, and the lab renders correctly without it.

### 5.4 Responsive behaviour

| Width | Behaviour |
| --- | --- |
| ≥ 1200 px | Rail, Inspector and dock float over the viewport |
| 760–1199 px | Inspector starts collapsed to its edge tab. The dock is limited to 45 % of the height. |
| < 760 px | Rail becomes a bottom toolbar. Inspector and dock become bottom sheets, one open at a time. The top bar keeps the name, the Study switch and Run, and moves the rest to ⋯. |

The viewport always fills the space that remains. No breakpoint stacks panels above or
below it.

### 5.5 Copy and density rules (see DESIGN.md §7)

- Panel headings use two words at most. Field labels are a noun plus its unit, for example
  "Mass (kg)".
- Panels contain no paragraphs. Model assumptions appear as one line on hover of an ⓘ icon and
  in full in the methods summary.
- Numbers use tabular figures, three significant digits by default, and a unit in the muted
  colour.

### 5.6 Units

SI is stored everywhere. The display preference (SI, or engineering with mm, MPa and kN)
lives in the experiment and is converted only at render and input, following the AGENTS.md
rule to convert units for display at the edge of the system. `UnitInput` parses suffixes
and rejects incompatible dimensions.

### 5.7 Accessibility

- Every floating panel is a labelled region. Focus moves into a flyout when it opens and
  returns to its trigger when it closes.
- The viewport has a text alternative: the Outline is a keyboard-navigable list of the same
  objects, and the dock readout is an `aria-live="polite"` region throttled to 2 Hz.
- Colour is never the only signal. Stress fields keep the colour bar with numbers, and plot
  series combine colour with markers or dash patterns.
- `prefers-reduced-motion` disables camera easing and panel transitions.

---

## 6. Contracts and versions

| Contract | Change | Owner |
| --- | --- | --- |
| `physix.lab/2` | New parts, materials, environment, full initial state. `migrateLabV1` with fixtures. | `web/src/lab/motion/scene.ts` |
| `physix.experiment/1` | New: studies, probes, protocol, sweep, noise, runs, units | `web/src/lab/state/experiment.ts` with a JSON Schema in `docs/schemas/` |
| `physix.run/1` | New run record | `web/src/lab/motion/run.ts` |
| `physix.case/2` | Analysis type, hole shapes, notches, load list, support kinds. `case_from_dict` accepts `/1`. | `physics/case.py` |
| `physix.prediction/2` | Optional displacement, reactions and Kt fields | `mcp/physix_mcp/service.py` |
| `physix.domain/1` | Unchanged. New geometry kinds are out of domain by definition and go to FEM. | `data/domain.py` |

Each bump updates `docs/CONTRACTS.md`, adds versioned fixtures under `tests/fixtures/`, and
updates every consumer in the same change, as AGENTS.md requires. JSON Schemas let
TypeScript and Python validate the same files.

---

## 7. Phases

Each phase ends with something students can use. Exit criteria are checks, not intentions.

### Phase 0: Foundations (about 1 week)

- Commit the current lab work on a branch and adopt `docs/DESIGN.md`.
- Move the tokens into one `tokens.css`. Delete the dark tokens in `styles.css` and the
  literal hex values in `lab.css` and `stress.css`.
- Add the `FloatingPanel`, `Dock`, `Toast` and `UnitInput` primitives with tests.

*Exit:* the visual diff of the current lab and studio is limited to the token fixes listed in
DESIGN.md §10, lint and build pass, and no literal colour remains outside `tokens.css` and the
colour maps.

### Phase 1: One lab shell (about 2 weeks)

- Build `LabShell` with the top bar, parts rail, Inspector, collapsed dock and Study switch.
- Move the current Motion features into the shell.
- Mount the stress studio's editor, field view, verify and optimize flows as the Stress study,
  without tabs.
- Model card becomes a sheet. Add the redirects for every old route. Add undo and redo.

*Exit:* every current capability is reachable from `#/lab` with no page tabs. Old URLs
redirect correctly (Vitest route tests). A browser walkthrough of both studies runs without
console errors at 1440, 1024 and 390 px wide.

### Phase 2: Measurement and theory (about 3 weeks)

- Probes, time series, dock plot and table, energy and momentum, contact forces, events and
  stop conditions.
- Theory overlays for the existing three templates plus pendulum, spring–mass and projectile.
- Timestep convergence. CSV and experiment export. Methods summary.
- Stress line probes, Kt with Kirsch and Heywood references, reactions, safety factor and the
  surrogate-versus-FEM difference map.

*Exit:* each template's simulated key quantity matches its analytic reference within a stated
tolerance at the default step (tests in `simulation.test.ts`/`theory.test.ts`), and the
convergence order is reported. The stress line probe matches FEM point evaluation on the
canonical plate. A re-imported export reproduces the same results.

*Status, Motion slice (done):*

- Probes cover block position, velocity, speed, acceleration and energy, the ideal pulley's
  displacement, speed and tension, and system energy and momentum, all at 60 Hz.
- Four events (rest, leaves the ramp, touches the floor, weight reaches its stop) resolve to
  one step. A protocol stops a run at an event or a time limit. The live run pauses at the
  same step as the headless run.
- A projectile template joins incline, friction and Atwood.
- Each template has closed-form references with stated tolerances: 1 to 3 %, and 10⁻⁶ for
  the ideal Atwood model. Measured agreement at the default step: incline within 0.1 %,
  friction within 0.2 %, projectile within 0.06 %, Atwood exact.
- Scenes that break a reference's assumptions show "Assumption broken" with the reason.
- The dock has a plot with dashed theory curves, a table, Δ chips and the step check
  (Δt, Δt/2, Δt/4, observed order and a 1 % pass rule).
- Experiment JSON, a tidy CSV and a methods summary can be exported. Importing an
  experiment re-runs it and reports whether the stored run was reproduced exactly.

*Status, Stress slice (done):*

- The Results dock has three views: Summary, Line probe and FEM check.
- Line probes plot σxx, σyy, τxy, von Mises or the model spread along a preset or drawn
  line. The surrogate is the solid line and FEM the dashed reference. Plates offer the net
  section and the centreline; brackets offer the web and flange sections. Drawn ends can
  be dragged. Profiles export as CSV (`physix.probe/1`).
- The FEM response carries element-vertex stress, so the probe evaluates the solver
  field exactly. `line_probe_v1.json` pins Python and TypeScript to 10⁻⁶ of peak. This
  meets the exit criterion.
- A line that cuts the part reports its section resultant against the applied force.
  On the canonical plate, the FEM net section carries 3.99 kN of 4.00 kN.
- Kt is reported against Kirsch and Heywood, with the hotspot rule in the tooltip.
  Outside the references' assumptions (a single centred hole in axial tension, away from
  the ends, d/H ≤ 0.6), the reason is shown instead. On the reference mesh FEM gives 3.39
  against Heywood's 3.35.
- The safety factor uses the material's yield strength or a value the user enters.
- After an FEM check, the summary shows applied force, reaction and equilibrium residual.
- The FEM check adds masked RMSE to the difference map. Model disagreement is labelled
  as spread between models and never mixed with error against the solver.

*Moved:* the pendulum and spring–mass overlays go to Phase 3, which adds rods and springs.
Contact-force probes go to Phase 3 with the contact-force events.

### Phase 3: New parts and studying variables (about 3 weeks)

- Spheres, cylinders, springs, rods and ropes, simulated pulley, applied forces, launcher,
  drag, restitution and the materials library. `physix.lab/2` with v1 migration.
- Pendulum and spring–mass theory overlays, and contact-force probes.
- Sweep sheet with a worker pool, seeded repeats, virtual-sensor noise, fitting with
  uncertainties, run history and comparison.
- Stress sweeps (surrogate screen with FEM confirmation) and the convergence study sheet.

*Exit:* the "μ from incline angle" investigation recovers the configured μ within its fitted
uncertainty. The simulated Atwood pulley agrees with the ideal formula when inertia is zero.
A 100-point sweep finishes without blocking the UI, and the timing is reported with hardware.
Determinism behaves as documented in §4.1.

*Status, studying variables (done):*

- "Sweep…" in the Motion menu opens one sheet: vary one scene variable over a range, read
  one metric from each run, and optionally add seeded synthetic sensor noise (σ,
  resolution, readings per value, seed). The metric is a reference's measured value, a
  probe statistic (value at stop, maximum, minimum, mean) or the stop time.
- Each value runs once headlessly on a pool of module workers, one fewer than the logical
  processors. Points stream into the dock's new Sweep view and can be cancelled. Runs are
  deterministic, so repeats differ only by synthetic noise. Readings are keyed by (seed,
  point, repeat) and do not depend on worker scheduling.
- The Sweep view plots filled simulated values, hollow synthetic readings, the dashed
  closed form and a fit over its ±2 SE band. Fits use linear, quadratic, cubic, power,
  exponential, the incline law or a typed expression (hand-written parser, no `eval`),
  weighted by the reading uncertainty when noise is on. Parameters show ± 1 SE, R²,
  χ²/dof and whether a configured value lies within 2 SE.
- `physix.sweep/1` records the design, every point, the engine version and the timing
  boundary. The experiment file carries the last sweep and its fit, and importing it
  restores the plot and repeats the fit. Sweep CSV and a methods paragraph are exported.
- *Exit evidence, measured.* On the incline template, 5° to 54.5° in 0.5° steps (100
  values), with σ 0.05 m/s², resolution 0.001 m/s² and 3 readings each, the fit gives
  μ = 0.20063 ± 0.00038 against the configured 0.2, with χ²/dof 1.21 over 261 readings.
  The 13 values at rest (θ ≤ 11°) are left out, since the incline law covers sliding only.
  Without noise, the default 11-value sweep gives μ = 0.2000006 ± 0.0000015. The template
  reaches a fitted μ in four clicks.
- *Timing.* The 100-value sweep took 1.65 s from first dispatch to last point, including
  worker start-up and engine set-up, on 15 workers. Hardware: AMD Ryzen 9 7940HS (16
  logical processors, 15 GB RAM), Chromium in the desktop preview, dev build, warm
  cache. During the sweep, no main-thread gap exceeded 50 ms (largest 49.7 ms, measured by
  message-channel ping).

*Status, oscillators (done):*

- Scene contract `physix.lab/2` adds a ball, a rigid pendulum and a vertical spring–mass with
  a viscous damper. `physix.lab/1` scenes migrate unchanged. Validation rejects any set-up
  whose swing would reach the floor or the spring anchor. New templates: Rolling ball,
  Pendulum and Spring oscillator.
- References: rolling without slipping, a(θ) = 5/7 g sin θ, switching to sliding when
  μ < 2/7 tan θ; the small-angle pendulum period, broken beyond 10°; the exact
  elliptic-integral period; and the damped spring period 2π / (ω₀ √(1 − ζ²)), broken at
  ζ ≥ 1. Periods are measured from mean zero crossings. A damped swing is read until it
  fades to 10⁻³ of its release offset. The overlays draw θ₀ cos ωt and the damped
  sinusoid.
- Sweeps accept the new fields and propose the pendulum length and the spring mass. A
  "Period about the mean" probe statistic works on any column. The sweep sheet trims a
  range to the values the scene accepts. Fits add the pendulum law (fitting g) and the
  spring law (fitting k), with the configured value shown for comparison.
- *Exit evidence, measured.* The engine pendulum period matches the exact period within
  10⁻⁶ (relative). Spring periods match within 2 × 10⁻⁴ for ζ up to 0.4. A pendulum length
  sweep from 1.5 to 4.5 m (13 values, 3°, σ 0.01 s, 3 readings each) recovers g within
  2 SE of 9.81 m/s², with SE below 0.03. Without noise, the small-angle law fits
  g = 9.8054 m/s², a model bias of 0.05% from the amplitude and the bob's inertia. A spring
  mass sweep recovers k = 80 N/m within 5 × 10⁻³.

*Status, simulated pulley (done):*

- The pulley is now a frame of fixed Rapier colliders (base plate, upright, wheel) with
  two kinematic weights. The engine steps the rope as one system: while it is taut the
  weights move with a = g (m₂ − m₁)/(m₁ + m₂ + M/2), integrated exactly over each step. A
  slack rope lets each weight fall freely while the wheel spins on. Landing on the base and
  meeting the wheel are inelastic stops, and a rope pulled tight again takes an inelastic
  jerk that conserves momentum along the rope. The kinematic weights push other parts out
  of their way but are not pushed back.
- `wheelMass` (0 to 20 kg, optional, default 0) makes the wheel a uniform disc. Tensions
  split into T₁ = m₁ (g + a) and T₂ = m₂ (g − a), and both are recorded with the weight
  heights and the wheel's rim speed. Energy includes the wheel (M v²/4), and potential
  energy is measured from y = 0 like every other part. The wheel mass is a sweep field.
- References: the acceleration, the tension (both tensions with a massive wheel) and the
  time for the descending weight to land after 1.37 m of rope travel.
- *Exit evidence, measured.* With the default 2 kg and 3 kg weights and a massless wheel,
  the engine's acceleration and tension equal the ideal Atwood values within 10⁻¹⁵ at
  steps of 1/120, 1/240 and 1/480 s. The landing time is 1.18333 s against the ideal
  1.18175 s, inside one step. With a 2 kg wheel, a = 1.635 m/s², T₁ = 22.890 N and
  T₂ = 24.525 N match the closed forms to the same precision. The landing time is 1.30000 s
  at 1/120 s and 1.29583 s at 1/240 s and 1/480 s against the ideal 1.29454 s. Every mass
  pair tested settles at its stop with the rope holding the lighter weight (T = m g).

*Status, materials, restitution, cylinders and the launcher (done):*

- Free bodies (blocks, balls and the new solid cylinder, which lies along z and rolls along
  x) carry optional `restitution`, their own `friction`, a library `material` label and a
  vertical launch speed `vy`. The library holds wood, steel, rubber, ice and felt with
  friction, restitution and density; choosing one copies μ and e and leaves the mass alone,
  since a solid lab-sized steel part would exceed the 100 kg limit.
- Contacts take the smaller of the two friction coefficients and the larger of the two
  restitutions. A body without its own coefficient carries 2, so floors and ramps keep
  governing as before. The engine's rebound speed equals e times the impact speed, but the
  ball sinks about 2 cm into the floor at 1/120 s, so e is measured as a speed ratio rather
  than from the rebound height.
- New presets: a steel ball launched at 10 m/s and 45°, a rubber ball dropped from 2 m and a
  collision track with two equal steel balls (2 kg striker at 3 m/s, 1 kg target) on a
  frictionless floor. New events: `bounce` and `collision`. A head-on pair runs to twice its
  impact time plus half a second so both speeds settle.
- References: flight time, range and peak height for any launch; e = v_out / v_in for a
  bouncing body, read from the samples either side of the bounce carried to the bounce
  time by free fall; both velocities after a head-on impact of equal balls; and the rolling
  acceleration a = g sin θ / (1 + k) with k = 2/5 for a ball and 1/2 for a cylinder, which
  slips when μ < k/(1 + k) tan θ. The collision reference is limited to equal balls on a
  frictionless floor, because unequal radii and block faces put the engine 1 to 5 % off
  the one-dimensional result.
- Sweeps vary `vy`, restitution, own friction, and a cylinder's radius and length.
- *Exit evidence, measured* at steps of 1/120, 1/240 and 1/480 s (probe rate up to
  240 Hz). The launcher's flight time is 1.44167 s against 1.44159 s and its range is within
  8 × 10⁻⁵. Its peak height approaches 2.74837 m as the step shrinks (−1.4, −0.66 and
  −0.38 × 10⁻³ relative). The measured e is 0.6 (steel) and 0.8 (rubber) within 3 × 10⁻⁷.
  After the impact the striker moves at 1.40000 m/s and the target at 3.20000 m/s, the
  closed forms within 2 × 10⁻⁷. A rolling cylinder on the 26° ramp with μ = 0.2 accelerates
  at 2.8674, 2.8658 and 2.8680 m/s² against 2.86695. With μ = 0.05 it slips at 3.8296,
  3.8432 and 3.8597 m/s² against 3.85956, converging with the step.

*Status, applied forces and air drag (done):*

- A free body may carry `force: {x, y, start, end}`, held at its centre and averaged over
  each step's overlap with the interval, so the impulse is exact at any step. The scene
  gains `airDensity` and `linearDrag`, and a body an optional `dragCoefficient` (0.47 for a
  ball, 1.05 for a block and 1.2 for a cylinder by default). Drag is translational,
  F = −(b + c |v|) v with c = ½ ρ C_d A. Each step holds the force that makes the engine's
  update follow the exact solution of v′ = a − k v, with |v| at the step's midpoint, so
  velocities match the closed forms to about 10⁻⁶ and the terminal speed is exact.
- New presets: a 2 kg block pushed by 10 N for 1 s on μ = 0.35, and a 0.3 m, 0.5 kg ball
  dropped 15 m through sea-level air (ρ = 1.2 kg/m³). The 3D view draws the force as an
  arrow until it ends.
- References: the push's acceleration a = (Fₓ − μ (m g − F_y)) / m, its speed when the
  force ends and the distance to rest a T²/2 + v²/(2 μ g); a quadratic-drag drop's fall
  time (v_t/g) arcosh(e^(g h/v_t²)) and impact speed v_t √(1 − e^(−2 g h/v_t²)); and a
  linear-drag launch's flight time and range. Drag-free references in a scene with air or
  with a force are kept but flagged as broken, and their curves are hidden. Both drag laws
  at once have no closed form. A round body pushed on a rough floor rolls, so its push is
  flagged too.
- Sweeps vary air density, linear drag, a body's drag coefficient and each force
  component and time. The methods paragraph states the air and the forces.
- *Exit evidence, measured* at steps of 1/120, 1/240 and 1/480 s (probe rate up to
  240 Hz). The pushed block accelerates at 1.566503, 1.566532 and 1.566482 m/s² against
  1.5665. Its speed when the force ends converges at first order (1.568157, 1.567259,
  1.566827 m/s against 1.5665), and so does its distance to rest (1.142995, 1.141701,
  1.141071 m against 1.1406). The falling ball lands at 7.810395, 7.810417 and 7.810416 m/s
  against 7.810436 (v_t = 7.8433 m/s). Its fall time is 2.466667, 2.466667 and 2.464583 s
  against 2.464969, resolved to the probe sample. The 45° launcher with b = 0.5 N·s/m flies
  for 1.366667, 1.366667 and 1.364583 s against 1.364197 s, with range 8.184762,
  8.180154 and 8.173665 m against 8.173401 m. Vertical speeds in free flight match
  the exact solution to 10⁻⁶ at every step.

*Status, rods, ropes and contact forces (done):*

- A pendulum has a `link`, `rod` or `rope`, and a rod may have a mass `rodMass`. The rod's
  mass is a collider-free mass at its middle with the inertia of a thin rod, so the body
  has I = m L² + (2/5) m r² + M L²/3 about the pivot and gravity a lever of m L + M L/2. A
  rope is a Rapier rope joint: it goes slack when the bob moves inwards and its bob does
  not turn.
- New probes: every free body records its contact `normal` and `friction` forces, and the
  pendulum's `tension` is now measured instead of computed from the angle. Rapier's
  contact impulses did not give usable forces (the incline normal read 22.9 N against
  17.6 N, and the tangent impulses were zero), so both are measured from momentum: the
  force over the step before a sample is m Δv/h + m g ŷ less any applied force and drag,
  split along the mean contact normal. The pendulum's `omega` is now the bob's swing rate
  about the pivot, so a rope's bob has one too, and its energies include a massive rod.
- New presets: a 1 kg bob on a 2 kg rod released at 8°, and a bob released at 120°, above
  the pivot, on a 3 m rope. The 3D view draws a massive rod thicker and a rope as a line
  that sags when slack.
- References: the period uses the generalized inertia and lever, so a compound pendulum's
  T₀ = 2π √(I / ((m L + M L/2) g)). A new bottom tension (m + M) g + (m L + M L/2) ω²,
  ω² from energy, is read as the largest sample over the first period. A rope released
  above the horizontal has no period: it falls freely through 2 L |cos θ₀| until taut, at
  t = √(−4 L cos θ₀ / g), and the jerk keeps |sin θ₀| of the fall speed. The friction,
  incline and push templates add N and F_f references (m g and μ m g on the floor,
  m g cos θ and μ m g cos θ on the ramp or m g sin θ when it holds, m g − F_y while
  pushed), read as means over the slide, the time on the ramp or the push.
- Sweeps vary a rod's mass. The methods paragraph names each pendulum's link and how
  forces are measured.
- *Exit evidence, measured* at steps of 1/120, 1/240 and 1/480 s (probe rate up to 240 Hz).
  The sliding block's mean normal force is 19.62000, 19.62001 and 19.62001 N against
  19.62, and its friction 6.86699, 6.86708 and 6.86674 N against 6.867. On the incline the
  block reads N = 17.63436, 17.63436 and 17.63435 N against 17.63434, and F_f = 3.52687,
  3.52678 and 3.52699 N against 3.52687. The 8° pendulum's bottom tension is 10.00058,
  10.00059 and 10.00060 N against 10.00060. The compound pendulum released at 30° swings
  with period 3.22874, 3.22878 and 3.22881 s against 3.22881, and pulls 35.72927, 35.73114
  and 35.73249 N against 35.73187. The slack rope pulls taut at 0.78155, 0.78180 and
  0.78193 s against 0.78206, and leaves the jerk at 6.63880, 6.64146 and 6.64305 m/s
  against 6.64417, both converging at first order.

*Status, run history, comparison and residuals (done):*

- Runs that reach their stop, runs kept by hand and imported runs persist in IndexedDB.
  History is kept per experiment *name* rather than per experiment ID, because the ID
  hashes the scene and protocol: a history per ID could only ever hold identical runs, so
  comparing a changed mass with the original would be impossible. Each experiment keeps 30
  runs and never drops the pinned baseline; without IndexedDB the history lives in memory.
- Run chips in the dock overlay the baseline and chosen runs on the live plot, up to six
  series with the live run, in the data-palette colours the live series does not use. A
  chip names how its run's inputs differ from the current scene, such as `g 1.62` or
  `block-1 mass 3`. Exports carry the live run, the baseline and the compared runs.
- "Re-run and check" compares every sample and reports bit for bit, within a relative
  tolerance of 10⁻⁹, or different, naming a sample-count change or a different Rapier
  version. Importing an experiment uses the same check.
- A fitted sweep draws a residual plot under the sweep plot: each reading (or clean value)
  less the fit, about a zero line inside the fit's ±2 SE band, with the values the fit left
  out also left out.
- *Exit evidence, measured:* re-running each of the 14 presets from its exported JSON
  matched bit for bit on every sample and column (40 to 601 samples, 14 to 30 columns).
  Tests cover a nudge of 10⁻¹² (within tolerance), 0.1 (different), a NaN in one run and a
  missing sample (different), the history's ordering, cap and single baseline, loads that
  finish after a run is kept, and an IndexedDB round trip that keeps NaN samples.

*Status, two-variable grids and perturbed starts (done):*

- The sweep sheet can add a second variable. Every pair runs on a grid of up to 400 points,
  each axis up to 200 values. The dock draws the grid as slices along the second variable:
  up to six evenly spread values, one per data-palette colour, each joined by a line. A note
  says when more slices exist, and the CSV export has every point. Grids are not fitted.
  The fit panel says so and points to the export.
- Repeats can rerun each point from a perturbed initial condition: a body's height or launch
  velocity, a pendulum's release angle, or a spring's release offset. The perturbation adds a
  seeded Gaussian draw with the student's σ and clamps the result to the variable's limits.
  Its stream key is kept apart from the sensor-noise stream, so noise and perturbation can be
  combined. The dock labels perturbed sweeps "Perturbed start" next to the "Synthetic noise"
  label. Methods text and the CSV report the perturbed inputs apart from the unperturbed run.
  A sweep runs at most 400 simulations in all, counting one per perturbed repeat.
- The new fields are optional in `physix.sweep/1`, so one-variable sweeps keep their
  identity and older files still load.
- *Exit evidence, measured* (AMD Ryzen 9 7940HS, Node, one in-process runner):
  - A 20 × 20 grid of pendulum length (1 to 2.9 m) and release angle (5° to 62°) ran all
    400 points in 5.96 s, with every value finite.
  - The period rose with length in 380 of 380 neighbouring pairs, and with amplitude in
    380 of 380.
  - At 2.9 m, T(62°)/T(5°) = 1.0774, against 1.0776 from the large-amplitude series
    1 + θ²/16 + 11θ⁴/3072.
  - With 20 perturbed repeats at 10° and σ = 2°, the drawn inputs had a standard deviation of
    1.95°. The periods' standard deviation was 2.08 ms, against 2.12 ms predicted from
    dT/dθ₀ ≈ T·θ₀/8.
  - Tests cover grid enumeration and the 400-point and 400-run caps, specs and identities
    for one-variable sweeps, clamped draws, the same perturbed grid on one runner and on three,
    and a CSV and JSON round trip.

*Status, Stress sweeps and the convergence study (done):*

- The Stress rail gains **Studies**, which opens two sheets: **Parameter sweep** and **Mesh
  convergence**.
- A Stress sweep varies one hole or bracket dimension over up to 41 values. The ensemble
  screens each point. Points the fallback policy rejects, points too tall for the model
  frame, and every point when no model is loaded are solved with FEM as `fem_fallback`. Any
  screened point can be checked with FEM, and it becomes `fem` with its screen kept.
- Each point shows its source as a badge and a marker. Surrogate markers are hollow, with
  ±1σ ensemble whiskers; solver markers are filled. The status line reports the largest
  surrogate-versus-FEM hotspot error over raster-basis points. The CSV export
  (`physix.stress-sweep/1`) records sources, the model id and the threshold.
- The convergence study (`physics.convergence.convergence_study`) solves the `fast`,
  `reference` and `fine` presets. It follows Celik et al. (2008) for three levels with
  unequal ratios: the observed order p, Richardson extrapolation with p capped at the
  formal order 2, and the fine-grid GCI. The safety factor is 1.25 for monotonic
  convergence. Oscillatory or divergent changes use Fs = 3 with the formal order and get
  no extrapolation.
- A level passes when the change to the next finer level is within 2% for both the hotspot
  and the field. The finest level passes when its GCI is within 2%. The sheet plots the
  hotspot and up to three line-probe points against element size, with the Richardson
  limit and the GCI band. It promotes the finest passing level, and while the student
  keeps it adopted, FEM checks of the part use that mesh (`mesh_preset` on
  `/api/verify`).
- The study runs in the Python service (`POST /api/convergence`) and in the Pyodide worker.
  It offers copyable methods text and a CSV export.
- *Exit evidence, measured* (AMD Ryzen 9 7940HS, Python service, scikit-fem, one warm run):
  - Canonical plate: 1022, 1857 and 4344 elements (h = 3.90, 2.89 and 1.89 mm) gave hotspots
    of 34.098, 33.922 and 33.913 MPa.
    - The convergence is monotonic, with an observed order of 10.2, capped at 2.
    - The Richardson limit is 33.906 MPa and the fine GCI is 0.024%. All three levels pass,
      and the fine level is promoted.
    - The solves took 268, 597 and 1784 ms (2.68 s in all).
  - Canonical bracket: 812, 1418 and 2880 elements (h = 3.26, 2.47 and 1.73 mm) gave
    176.34, 176.51 and 175.25 MPa.
    - The changes do not decrease (0.096%, then 0.72%), so the study reports no
      extrapolation.
    - The formal-order GCI with Fs = 3 is 2.09%, above the 2% tolerance, so the fine level
      fails. The reference level passes (0.72% hotspot and 0.50% field change to fine) and
      is promoted.
    - The re-entrant corner of the bracket is the expected mesh-sensitive hotspot, which is
      why its study is weaker than the plate's.
  - Tests cover:
    - manufactured orders 1, 1.5 and 2 on unequal ratios, the order cap, and the
      oscillatory, divergent and converged cases;
    - the plate study's ordering and promotion, a forced failure that promotes the
      reference level, and probe and preset validation;
    - the service and HTTP routes, and the `mesh_preset` override;
    - every sweep source path, abort, the summary, the CSV, the sheets' rendering, and a
      shared `convergence_v1.json` fixture checked by Python and rendered by the web
      sheet.

### Phase 4: Wider stress cases and the agent surface (about 3 weeks)

- `physix.case/2` with plane strain, slots and elliptical holes, notches, pin bearing,
  combined loads and new supports. FEM only, each with analytic or manufactured tests.
- `.vtu` export, displacement and deformed shape.
- `simulate_scene`, `sweep` and `probe_field` MCP tools, and an updated skill.
- Cross-study quasi-static bridge.

*Exit:* every new case kind passes its physics test (an analytic or manufactured solution,
equilibrium, and mesh refinement within a stated tolerance). The surrogate refuses them
through the domain check with an explicit reason. MCP integration tests cover the new tools
with a real solver.

### Phase 5: Research polish and evidence (about 2 weeks)

- Templates for common lab reports: incline friction, pendulum period versus amplitude,
  damped oscillator, collisions and restitution, projectile with drag, hole Kt versus d/W,
  and plane stress versus plane strain.
- `CITATION.cff`, an updated `docs/DEMO.md`, the model card and methods text reviewed against
  real runs.
- Performance pass: cold and warm timings for both studies on documented hardware.

*Exit:* each template has a recorded reference run with its methods summary. Timing evidence
follows AGENTS.md (hardware, sizes, boundaries, cold versus warm). The full `make lint` and
`make test` suites and the production build pass on CI.

### Later (only with retraining evidence)

Extend the dataset and retrain the ensemble for plane strain and multi-hole plates. As
AGENTS.md requires, new weights need a fresh held-out evaluation before activation.

---

## 8. Workstreams and ownership

Follows the parallel-work rules in AGENTS.md: agree contracts first, give each workstream its
own branch or worktree, and leave shared files to the integration owner.

| Workstream | Files | Starts | Depends on |
| --- | --- | --- | --- |
| Design system and shell | `web/src/lab/ui/`, `LabShell.tsx`, `tokens.css`, `docs/DESIGN.md` | Phase 0 | Nothing |
| Motion engine | `web/src/lab/motion/`, `web/scripts/` | Phase 2 | `physix.lab/2` and `physix.run/1` agreed |
| Data tools | `web/src/lab/data/` | Phase 2 | `physix.run/1` agreed. Can build against fixtures. |
| Stress physics | `physics/`, `tests/physics/` | Phase 2 (probes), Phase 4 (case/2) | `physix.case/2` agreed |
| Stress study UI | `web/src/lab/stress/` | Phase 1 | Shell primitives |
| Agent surface | `mcp/`, `skills/`, `tests/mcp/` | Phase 4 | Runner CLI and case/2 |
| Integration | `docs/CONTRACTS.md`, `docs/schemas/`, fixtures, lockfiles, routes | Every phase | Merges contract changes first |

Each handoff records the commit, changed interfaces, checks run and known failures.

---

## 9. Testing and evidence

Following AGENTS.md, every new module gets tests in the same change.

| Subsystem | Tests |
| --- | --- |
| Motion | Analytic agreement for each template; energy balance residual with no friction or drag below tolerance; momentum conservation in collisions; timestep convergence order; joint and constraint limits; `physix.lab/1 → /2` migration fixtures; headless and browser parity on the same scene |
| Data tools | Fit recovery on synthetic data with known parameters and covariance; seeded noise reproducibility; sweep grid enumeration and caps; tidy CSV round trip with units; methods summary snapshot tests |
| Stress physics | Kirsch and Heywood Kt within tolerance on refined meshes; line-probe agreement with FEM point evaluation; reactions equal the applied resultant; plane strain against an analytic thick-plate case; each new geometry kind's validation limits and tags |
| UI | Route redirects; Inspector shows only fields for the selection; unit parsing and rejection; dock readout throttling; toast and inline error states; colour and unit consistency with DESIGN.md tokens; keyboard shortcuts |
| MCP | Schemas and provenance for new tools; sweep caps; solver failures; subprocess runner errors kept off stdout |

**Evidence rules carried into the UI**

- A theory delta is shown only next to the assumptions it depends on.
- A surrogate number always shows its source, bundle version and disagreement. An accuracy
  claim needs a matched FEM comparison on the same mask and units.
- Timings show cold or warm, the boundary that was measured, and the hardware string the
  browser reports.

---

## 10. How success is measured

| Measure | Target |
| --- | --- |
| Time from opening `#/lab` to a first plotted measurement | Under 30 s for a new user with a template |
| Clicks to run a 1D sweep and fit | 6 or fewer from a loaded template |
| Navigation depth | One workspace, zero page tabs, at most one sheet open |
| Reproducibility | 100 % of exported experiments re-run to matching results within the documented determinism level |
| Theory agreement | Every template within its stated tolerance at the default step |
| Panel density | No panel with more than 8 visible fields before expansion, and no help text longer than one line |

Validate these with 5–8 students on scripted tasks at the end of Phases 1 and 3, and record
the findings in `docs/WORKLOG.md`.

---

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Rapier joints and contact forces are noisy at a 120 Hz step | Expose step size (60–480 Hz) and solver iterations in scene settings. Report timestep convergence. Smooth only in display, never in exported data. |
| Students read synthetic noise as real measurement | Always label it "synthetic". Keep it off by default. Store it separately from clean series. |
| Large sweeps freeze low-end laptops | Worker pool sized from `navigator.hardwareConcurrency − 1`, caps, cancel, and streaming partial results |
| Pyodide FEM cold start (seconds) | Warm it after the first Stress interaction, show the progress, and screen with the surrogate first |
| The floating UI hides the scene on small screens | Collapsed defaults, bottom sheets under 760 px, and a "focus viewport" shortcut (`\`) that hides all panels |
| Contract churn across Python and TypeScript | JSON Schemas, shared fixtures, and integration-owner merges first |
| Scope creep into 3D stress or dynamics of deformables | The domain check and `UnsupportedCaseError` stay authoritative. The UI shows the rejection reason and offers the nearest supported study. |

---

## 12. Decisions needed before Phase 1

1. **Static hosting target.** Does the deployed build stay fully in-browser (Pyodide FEM), or
   does it also offer the local Python API? This affects how sweeps that need FEM are sized.
2. **Plot implementation.** Build the in-house plot component (recommended) or adopt `uplot`.
3. **Deterministic Rapier build.** Decide whether cross-machine bit-for-bit reproduction is a
   requirement for v2 or a documented later goal.
4. **Template list.** Confirm the Phase 5 templates against the courses Physix targets first.
