# Physix design system

This document records the Physix visual language for the home page, the lab and the stress
views, and the rules for the single-lab workspace described in
[LAB_PLAN.md](LAB_PLAN.md). It is the reference for every UI change in `web/`.

The style is calm, light and precise. Use a daylight background, green-grey ink, thin rules,
generous radii and well-aligned numbers. Editorial studio photography shows simple apparatus
in soft daylight. Oak, sage, and brass give the home page the warmth of a university lab.

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

All colours live in `web/src/tokens.css` as custom properties on `:root`. Components use
tokens only. Literal colours are allowed only in `tokens.css` and in the colour-map stop
tables in `web/src/ui/colormap.ts`, and a Vitest guard (`web/src/tokens.test.ts`) enforces
this. Alpha variants are written as `color-mix(in srgb, var(--px-…) N%, transparent)`.
Canvas and three.js code read tokens through `getComputedStyle`; see
`web/src/lab/viewportPalette.ts`.

`tokens.css` also keeps the legacy aliases (`--bg`, `--panel`, `--line`, `--text`, `--muted`,
`--accent`, `--copy` and others) that `styles.css` and the home page use. New
code uses the `--px-*` names.

### 2.1 Surfaces and ink

| Token | Value | Use |
| --- | --- | --- |
| `--px-daylight` | `#fefffc` | Page and floating-panel background |
| `--px-paper` | `#f9fbf7` | Button and input fill |
| `--px-wash` | `#f5f8f3` | Viewport surround, hovered rows, input fill |
| `--px-canvas` | `#f0f5ed` | Stress view page background |
| `--px-wash-strong` | `#edf3eb` | Selected rows, pressed segments, code blocks |
| `--px-selected` | `#e5eee3` | Current navigation item |
| `--px-rule` | `#e7ede6` | Dividers inside panels |
| `--px-edge` | `#dce4da` | Panel and control borders |
| `--px-edge-control` | `#d7e0d5` | Input and select borders |
| `--px-edge-strong` | `#bacaba` | Pill and callout borders |
| `--px-halo` | `#dcebe1` | Running-dot halo, pressed list items |
| `--px-glass` | `#fbfdf9eb` | Translucent chips and tags over a viewport |
| `--px-overlay` | `#f8fbf4d6` | Loading overlay over a field |
| `--px-scrim` | `#1d2a237d` | Behind sheets and dialogs |
| `--px-ink` | `#263229` | Primary text in the lab |
| `--px-ink-2` | `#45594c` | Secondary body text in the stress views |
| `--px-ink-muted` | `#59695d` | Labels, units, secondary values |
| `--px-ink-icon` | `#5b7465` | Panel icons and specimen outlines |
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
| `--px-warn` | `#875c15` | `#fbf6e5` | Fallback triggered, assumption broken, synthetic noise on |
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

The three.js scene reads these tokens at start-up, so a change in `tokens.css` reaches the
3D view without code changes.

| Element | Token | Value |
| --- | --- | --- |
| Background | `--px-viewport-bg` | `#eaf0e7` |
| Floor | `--px-viewport-floor` | `#e2eade` |
| Grid major and minor lines | `--px-grid-major`, `--px-grid-minor` | `#9bad9e`, `#c6d3c4` |
| Lights (sky, ground, sun) | `--px-viewport-sky-light`, `--px-viewport-ground-light`, `--px-viewport-sun` | `#ffffff`, `#84917f`, `#fff6e1` |
| Blocks | `--px-part-block`, edge `--px-part-block-edge` | `#edb765`, `#5a412a` |
| Ramps and fixed geometry | `--px-part-ramp`, edge `--px-part-edge` | `#83a398`, `#476d61` |
| Pulley | `--px-part-frame`, `-wheel`, `-rim`, `-hub`, `-spoke`, `-rope`, `-weight-left`, `-weight-right` | See `tokens.css` |
| Selection | The part's edge outline is shown | — |

From Phase 2, bodies take series colours in creation order so that a body's plot colour
matches its 3D colour, and velocity vectors use the body colour while forces use `--px-ink`
with labelled arrowheads.

### 2.7 Home page imagery and navigation

Use the pine-green P and brass block as the Physix mark in the home navigation, footer
and lab top bar. Pair it with the Physix wordmark where there is space. The favicon uses
the same mark on a light tile so the shape reads against light and dark browser chrome.

Lead with a clear lab link, a short description of what students can do, and a full-width
halftone illustration of apparatus in warm paper, sage, deep green and brass. Keep the
headline and actions on the quiet part of the illustration. Use a compact, floating top
bar, with two rows on small screens so all navigation links remain available. Use separate
wide and compact WebP crops for the hero and lazy load the experiment card photographs.
Keep the cards linked directly to their templates. Stress examples use actual scikit-fem
results with their own labelled scales.
`--px-mesh-line` is the stroke for FEM mesh previews drawn on a canvas.

---

## 3. Typography

| Role | Family | Size and weight | Use |
| --- | --- | --- | --- |
| Wordmark and titles | Bricolage Grotesque 600 | 18–68 px | Home page headlines, brand, experiment name, sheet titles |
| UI | Inter 500 and 600 | 13 px controls, 12 px labels, 11 px captions | Everything in the lab |
| Numbers | Inter 500 with `font-variant-numeric: tabular-nums` | Same as context | Readouts, tables, axes |

- Letter spacing is `-0.01em` for body text and `-0.02em` for titles.
- Numbers default to three significant figures. Units follow in `--px-ink-muted` at 0.85 em
  after a thin space, for example `3.18 m/s`.
- Use the monospace stack for code samples and editors.

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
| `--px-shadow-photo`, `--px-shadow-paper` | Black at 15 % and 8 % | Home page photographs and paper cards |

The home page keeps its editorial radii (12 px cards, 24 px figures, pill buttons). The
16/8/6 scale applies to the lab and the stress views.

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
| Parts rail | 78 px wide at the left. Show a short label with each icon. On compact screens use the same labels in a bottom toolbar. |
| Inspector | 280 px wide, floating 12 px from the right edge and below the top bar. It scrolls internally and collapses to a 28 px edge tab. Groups are collapsible and remember their state. |
| Data dock | Full width minus 12 px gutters, floating 12 px above the bottom edge. Collapsed height is 36 px (one readout line). Expanded height ranges from 200 px to 60 vh. |
| HUD | Axes gizmo bottom-left, scale bar bottom-centre, colour bar right of centre (Stress), provenance chip top-left under the bar. HUD items move clear of the open panels. |
| Sheets | Centred, at most 720 px wide, on `--px-scrim`. One sheet at a time. Escape closes it. |

### Floating panels

- Panels dock to fixed anchors. Free dragging is not supported.
- A collapsed panel leaves an edge tab with its icon and a label on hover.
- Opening one flyout closes any other flyout. The Inspector and dock can stay open together.
- `\` hides all chrome except the top bar ("focus viewport"), and pressing it again restores
  the previous layout.

### Positioning parts

- At the start of a Motion experiment, drag a part across the X–Z plane. Drag empty space to
  orbit. The Height toggle changes the release height of free bodies or the anchor of an
  oscillator. Ramps and pulleys stay on the floor.
- Highlight the part under edit. Show the move as a preview, commit it on release, and keep
  it as one undo step. Escape cancels the preview. Reset a run before moving its starting parts.
- With the viewport focused, arrows move the selected part by 0.1 m and Page Up or Page Down
  changes height. Shift increases the increment to 1 m. The Outline and numeric inspector
  provide another way to select and position each part.

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
| Plot | Axes in `--px-ink-muted` 11 px, gridlines in `--px-rule`, ticks 1, 2 or 5 × 10ⁿ apart, and a series stroke of 1.75 px. The theory curve is dashed in `--px-ref`. Samples appear up to the live time. Hover shows a cursor and a `t · value` readout in the key. Axis titles include units. The horizontal axis is time unless a plot names another, such as distance along a probe line. A sampled reference, such as an FEM profile, is drawn like the theory curve and breaks where it is undefined. Linking the cursor to the viewport is still to come. |
| Sweep plot | The metric against the swept variable, on the Plot axes. The frame holds the swept range, padded 4 %, while points stream in. Simulated values are filled 3.25 px markers in the target's series colour, shrinking to 2 px when synthetic readings sit beside them as hollow 3.25 px markers with a 1.25 px stroke. The closed form is the dashed reference line. A fit is a solid series line over its ±2 SE band at 16 %. Hover snaps to the nearest swept value and shows its value, theory, reading mean and fit in the key. |
| Sweep sheet | Vary, From, To and Step on one row of three, then Read. A "Synthetic sensor noise" toggle reveals σ and Resolution in the metric's unit, Readings per value and Seed with a dice button for a new seed. The footer states runs, workers and readings before the primary "Run sweep". |
| Synthetic-noise chip | `Synthetic noise · σ 0.05 m/s²` in the warn tone, with the seed in its tooltip. It shows whenever readings are synthetic, so noise is never read as model error. An "Earlier scene" chip marks a sweep made before the scene was edited. |
| Fit summary | A model select and Fit button above a definition list: each parameter as `value ± SE` rounded to two significant digits of the SE, a "Within 2 SE of …" (ok) or "Outside 2 SE of …" (warn) chip when the scene sets that parameter, then R², χ²/dof with its degrees of freedom when weighted, and Points. A custom model takes an expression in monospace. |
| Probe line | A 2 px white line over a 4.5 px ink halo, with white end handles and `A` and `B` labels in small ink chips. It is shown while the Line probe view is open or a line is being drawn. While drawing, the cursor is a crosshair and a HUD chip offers Cancel. |
| Comparison row | The quantity and its symbol with an ⓘ for the formula and assumptions. Next come Sim and Theory values in tabular figures, then one chip: `Pending` until the live run reaches the event, `Δ …` coloured by tolerance, or `Assumption broken` (warn) with the reason as its tooltip. |

---

## 7. Copy and density

Use [COPYWRITING.md](COPYWRITING.md) for product positioning, homepage copy, interface
wording and engineering claims.

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

These differences from the earlier tree are adopted with this document. Items 1–5 are done
(Phase 0). Items 6, 7, 9 and 10 land in Phase 1 and item 8 in Phase 2 of LAB_PLAN.md.

| # | Earlier | Fix |
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
