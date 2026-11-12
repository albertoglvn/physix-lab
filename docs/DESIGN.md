# Physix design system

This document records the Physix visual language, the pastoral style used by the home page,
the lab and the stress views, and the rules for the single-lab workspace described in
[LAB_PLAN.md](LAB_PLAN.md). It is the reference for every UI change in `web/`.

The style is calm, light and precise: a daylight background, green-grey ink, thin rules,
generous radii and dense, well-aligned numbers. The lab should look like a well-kept
instrument, not a dashboard.

---

## 1. Principles

1. **The viewport is the workspace.** Controls float over it. Nothing pushes it into a card.
2. **Data first.** Show values with units. Move explanations into tooltips and the methods
   summary.
3. **One way to do each thing.** Each action has one visible home. The command palette
   mirrors actions and does not add new ones.
4. **Quiet chrome, loud results.** Panels use neutral tokens, and colour is reserved for
   state (running, warning, error) and for data.
5. **Honest provenance.** Every computed value can show where it came from.

---

## 2. Colour tokens

All colours live in `web/src/tokens.css` as custom properties on `.pastoral`. Components use
tokens only. Literal colours are allowed only in colour-map stop tables and in SVG
illustrations under `assets/`.

### 2.1 Surfaces and ink

| Token | Value | Use |
| --- | --- | --- |
| `--px-daylight` | `#fefffc` | Page and floating-panel background |
| `--px-wash` | `#f5f8f3` | Viewport surround, hovered rows, input fill |
| `--px-wash-strong` | `#edf3eb` | Selected rows, pressed segments |
| `--px-edge` | `#dce4da` | Panel and control borders |
| `--px-rule` | `#e7ede6` | Dividers inside panels |
| `--px-ink` | `#263229` | Primary text in the lab |
| `--px-ink-muted` | `#59695d` | Labels, units, secondary values |
| `--px-ink-faint` | `#819185` | Decorative separators only, never text that must be read |
| `--px-editorial-ink` | `#2c2c2c` | Home page prose only |
| `--px-prose` | `#646464` | Home page body copy only |

### 2.2 Actions and focus

| Token | Value | Use |
| --- | --- | --- |
| `--px-primary` | `#1f1f29` | Primary button fill (Run, Apply, Save) |
| `--px-primary-edge` | `#282834` | Primary button border |
| `--px-primary-hover` | `#393b45` | Primary button hover |
| `--px-accent` | `#32664e` | Selected segment, active icon, links inside the lab |
| `--px-focus` | `#167961` | 2 px focus outline with a 3 px offset |
| `--px-sky` | `#0081c0` | Home page glass actions and illustrations only |

### 2.3 State

| Token | Value | Background tint | Use |
| --- | --- | --- | --- |
| `--px-ok` | `#357448` | `#eaf2e8` | Running, solver online, verified |
| `--px-warn` | `#875c15` | `#f7efdf` | Fallback triggered, assumption broken, synthetic noise on |
| `--px-bad` | `#a13e36` | `#faeeea` (edge `#f3d9d4`) | Errors, rejected case, failed solve |
| `--px-ref` | `#6c408a` | `#f1ebf5` | Reference or FEM values and theory curves |
| `--px-idle` | `#9eae9d` | — | Idle status dot |

State is never shown by colour alone. Pair it with an icon, a label or a dash pattern.

### 2.4 Data colours

Plot series take colours in this order. The order is chosen so that the first three remain
distinguishable for common colour-vision deficiencies when combined with markers.

| Order | Token | Value |
| --- | --- | --- |
| 1 | `--px-series-1` | `#32664e` (green) |
| 2 | `--px-series-2` | `#0081c0` (sky) |
| 3 | `--px-series-3` | `#b07a1a` (ochre) |
| 4 | `--px-series-4` | `#6c408a` (plum) |
| 5 | `--px-series-5` | `#a13e36` (brick) |
| 6 | `--px-series-6` | `#4d5b70` (slate) |

- Theory and reference curves use the series colour with a 4–3 dash, or `--px-ref` when there
  is one reference.
- Fit bands use the series colour at 16 % opacity.
- Synthetic-noise points use hollow markers.
- At most six runs are compared at once. A seventh replaces the oldest unpinned run.

### 2.5 Field colour maps

The maps in `web/src/ui/colormap.ts` are part of the design system and must not be
redefined elsewhere.

| Map | Use |
| --- | --- |
| `stress` (navy → teal → yellow → red) | Von Mises and other non-negative magnitudes |
| `diverging` (blue → near-white → red), centred on zero | Signed components σxx, σyy, τxy and FEM-minus-surrogate differences |
| `spread` (near-black → violet → pale) | Ensemble disagreement only |

Each field view shows its colour bar with numeric ticks, units and the range rule (shared or
per-field). The same quantity in the same experiment uses the same range unless the user
unlocks it.

### 2.6 Viewport palette (Motion)

| Element | Value |
| --- | --- |
| Background | `--px-wash` |
| Grid major and minor lines | `#9bad9e`, `#c6d3c4` |
| Ramps and fixed geometry | Warm grey `#c9c3b5` with `--px-edge` outlines |
| Bodies | Series colours in creation order, so a body's plot colour matches its 3D colour |
| Selection | `--px-accent` outline, 2 px, plus a 3 px `#dcebe1` halo |
| Vectors | Velocity uses the body colour. Forces use `--px-ink` with labelled arrowheads. |

---

## 3. Typography

| Role | Family | Size and weight | Use |
| --- | --- | --- | --- |
| Display | Instrument Serif 400 | 44–72 px | Home page headlines only |
| Wordmark and titles | Bricolage Grotesque 600 | 18–43 px | Brand, experiment name, sheet titles |
| UI | Inter 500 and 600 | 13 px controls, 12 px labels, 11 px captions | Everything in the lab |
| Numbers | Inter 500 with `font-variant-numeric: tabular-nums` | Same as context | Readouts, tables, axes |

- Letter spacing is `-0.01em` for body text and `-0.02em` for titles.
- Numbers default to three significant figures. Units follow in `--px-ink-muted` at 0.85 em
  after a thin space, for example `3.18 m/s`.
- Do not add another typeface. A monospace stack (`ui-monospace, "Cascadia Mono", Menlo,
  monospace`) is allowed only in the Scene JSON editor.

---

## 4. Shape, depth and spacing

| Token | Value | Use |
| --- | --- | --- |
| `--px-radius-panel` | 16 px | Floating panels, sheets, dock |
| `--px-radius-control` | 8 px | Buttons, inputs, selects, segmented controls |
| `--px-radius-chip` | 6 px | Run chips, pills, tags |
| `--px-shadow-float` | `0 8px 24px #344b341f, 0 1px 2px #344b3414` | Floating panels over the viewport |
| `--px-shadow-sheet` | `0 24px 64px #26322933` | Modal sheets |
| `--px-shadow-flat` | `0 2px 6px #344b3412` | Cards on the home page |

- The spacing scale is 4, 8, 12, 16, 24 and 32 px. Panels use 12 px horizontal and 16 px
  vertical padding.
- Control heights are 32 px in panels, 36 px in the top bar and 44 px for touch targets
  below 760 px.
- Borders are 1 px `--px-edge`. Use dividers (`--px-rule`) inside panels instead of nested
  boxes.

### Layers (z-index)

| Layer | Value |
| --- | --- |
| Viewport HUD | 10 |
| Rails, Inspector, dock | 20 |
| Flyouts and popovers | 30 |
| Top bar | 40 |
| Toasts | 50 |
| Sheet and its scrim | 60 |
| Command palette | 70 |

---

## 5. The lab layout

The lab is one full-window viewport with floating chrome. LAB_PLAN.md §3.2 has the
diagram.

| Region | Rules |
| --- | --- |
| Top bar | 48 px high, `--px-daylight` with a bottom `--px-rule`. Left: mark and editable name. Centre: Study switch and transport. Right: three status dots and the ⋯ menu. No other buttons. |
| Parts rail | 48 px wide, floating 12 px from the left edge, vertically centred. Icon buttons only, each with a tooltip and a shortcut. |
| Inspector | 280 px wide, floating 12 px from the right edge and below the top bar. It scrolls internally and collapses to a 28 px edge tab. Groups are collapsible and remember their state. |
| Data dock | Full width minus 12 px gutters, floating 12 px above the bottom edge. Collapsed height is 36 px (one readout line). Expanded height ranges from 200 px to 60 vh. |
| HUD | Axes gizmo bottom-left, scale bar bottom-centre, colour bar right of centre (Stress), provenance chip top-left under the bar. HUD items move clear of the open panels. |
| Sheets | Centred, at most 720 px wide, on a scrim of `#26322933`. One sheet at a time. Escape closes it. |

### Floating panels

- Panels dock to fixed anchors. Free dragging is not supported.
- A collapsed panel leaves an edge tab with its icon and a label on hover.
- Opening one flyout closes any other flyout. The Inspector and dock can stay open together.
- `\` hides all chrome except the top bar ("focus viewport"), and pressing it again restores
  the previous layout.

### Breakpoints

| Width | Behaviour |
| --- | --- |
| ≥ 1200 px | Full floating layout |
| 760–1199 px | Inspector starts collapsed. Dock capped at 45 vh. |
| < 760 px | Rail becomes a bottom toolbar. Inspector and dock become bottom sheets (one open at a time). The top bar keeps the name, the Study switch and Run. 16 px side gutters, no horizontal scroll. |

---

## 6. Components

| Component | Specification |
| --- | --- |
| Button | 32 or 36 px high, 8 px radius, `--px-daylight` fill, 1 px `--px-edge`. Primary uses `--px-primary`. Icons are 16 px Lucide icons with stroke width 2. |
| Icon button | Square, same height as a button, with a required `aria-label` and tooltip |
| Segmented control | Study switch and Plot/Table toggles. At most three segments. The selected segment uses `--px-wash-strong` with `--px-accent` text. |
| Field | Label above the input, as a noun with its unit in parentheses. The input is right-aligned with tabular figures and accepts unit suffixes. Errors show inline below in `--px-bad`, in one line. |
| Readout | A label in `--px-ink-muted` 11 px, then the value in 15 px tabular figures with its unit. A theory delta appears as a small chip `Δ 0.8 %` coloured by tolerance (ok, warn). |
| Status dot | 8 px circle. Idle, ok, warn or bad, with a halo when running. The tooltip gives the full status. |
| Provenance chip | `source · version · time`, for example `surrogate · unet5-2d0d · 4 ms warm`. Clicking it opens the model card or run details. Uses `--px-ref` for FEM sources. |
| Run chip | 6 px radius, a series-colour swatch, the run label, and pin and close icons |
| Toast | Top centre, at most 420 px wide, with an icon, one sentence and an optional action. Auto-dismisses after 5 s unless it is an error. |
| Plot | Axes in `--px-ink-muted` 11 px, gridlines in `--px-rule`, a series stroke of 1.75 px, and hover with a crosshair linked to the viewport. Axis titles include units. |

---

## 7. Copy and density

- Use sentence case everywhere, except proper names and units.
- Headings in panels use two words at most, for example "Initial state" or "Probes".
- No paragraphs in the lab. Help text is at most one line, otherwise it goes in a tooltip
  behind an ⓘ icon.
- Write labels as a noun with the unit in parentheses, for example "Mass (kg)" or
  "Friction (μ)".
- Empty states use one line and one action, for example "No probes yet · Probe selection".
- Errors name the field, the limit and the unit, for example "Angle must be between 5° and
  55°."
- Never use filler such as "Welcome to", "Simply", or "Powerful".
- A panel shows at most eight fields before the user expands a group.
- Status words are Ready, Running, Paused, Loading engine, Solving and Unavailable.

---

## 8. Motion

- Panel and flyout transitions take 150 ms with `ease-out`. Camera framing takes 300 ms.
- Running simulations never animate chrome. Readouts update at most 10 times per second
  visually, and 2 times per second for screen readers.
- `prefers-reduced-motion: reduce` disables camera easing and panel transitions.

---

## 9. Accessibility

- Text contrast is at least 4.5:1 against `--px-daylight` and `--px-wash`, which
  `--px-ink-muted` meets. `--px-ink-faint` is only for decoration.
- Every control is reachable by keyboard in visual order. Focus is always visible through
  `--px-focus`.
- The Outline is the accessible equivalent of the viewport. Selecting in either place selects
  in both.
- Field and plot colours always come with numeric scales, markers or patterns.

---

## 10. Fixes to the current UI

These differences from the current tree are adopted with this document and land in Phase 0
of LAB_PLAN.md.

| # | Current | Fix |
| --- | --- | --- |
| 1 | `styles.css` defines dark tokens (`--bg: #0a0e1a`, `--accent: #22d3ee`) that `stress.css` overrides | Delete the dark token block. Define all tokens once in `tokens.css`. |
| 2 | `lab.css` declares `--lab-*` tokens and repeats about 25 literal hex values | Replace them with `--px-*` tokens |
| 3 | Running dot `#3d8259` and error text `#8f342d` differ from `--ok` and `--bad` | Use `--px-ok` and `--px-bad` |
| 4 | Radii mix 6, 7, 8, 16 and 20 px | Use 16 for panels, 8 for controls and 6 for chips |
| 5 | Numbers use proportional figures and jitter while running | Apply `tabular-nums` to readouts, tables and axes |
| 6 | The lab viewport is a card inside a three-column grid | Make the viewport full-window with floating panels (§5) |
| 7 | `WorkspaceHeader` plus the `stress-navigation` bar add two layers of navigation | One top bar (§5) and route redirects (LAB_PLAN.md §3.1) |
| 8 | Inline help paragraphs, such as the pulley description and the inspector note | Move them into ⓘ tooltips and the methods summary |
| 9 | Theme colour in `index.html` is `#fefffc`, while the lab background is `--px-wash` | Keep `#fefffc` and set the viewport surround to `--px-wash` so the top bar matches the browser chrome |
| 10 | Lab breakpoints stack the viewport above the panels | Use the bottom-sheet pattern below 760 px (§5) |

---

## 11. Changing this document

Update DESIGN.md in the same change as any new token, component or layout rule. When a
change alters a shared visual contract, such as a colour map, units display or the series
order, update the Vitest UI checks in `web/src/ui/ui.test.ts` with it.
