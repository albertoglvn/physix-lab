# Physix Lab v2: one lab for research-grade experiments

This plan turns Physix from two adjacent tools (a 3D mechanics lab and a stress studio) into
one lab where a student or researcher designs an experiment, runs it, measures it, compares it
with theory, varies parameters, and exports evidence that holds up in a report or a paper. It
keeps the current pastoral visual style. [DESIGN.md](DESIGN.md) records the style rules, and
this plan cites it wherever the UI changes.

Status: proposal. Nothing in this document is implemented yet. It builds on the current
working tree, including the uncommitted `web/src/lab/` workspace, `browser-fem` worker,
`Home` page and `physix.lab/1` scene contract.

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

*Moved:* the pendulum and spring–mass overlays go to Phase 3, which adds rods and springs.
Contact-force probes go to Phase 3 with the contact-force events. The Stress items above
are the next Phase 2 slice.

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
