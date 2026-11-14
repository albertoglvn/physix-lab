# Physix usability and performance review

## Scope

Reviewed the public version 4 home, Motion workspace and Stress workspace, then exercised
the revised home and Motion workspace in the Codex in-app browser at desktop width and a
390 px viewport. The browser ran on a Windows machine with an AMD Ryzen 9 7940HS and
Radeon 780M graphics. The narrow viewport check used the desktop browser with a width
override. It does not establish performance or touch behaviour on a physical phone.

## Usability findings

| Area | Finding | Change and evidence |
| --- | --- | --- |
| First visit | The full-screen illustrated introduction made the entrance compete with the artwork. | The lab and experiment links now sit with the headline on a daylight canvas. The hero photograph remains visible on a 390 px screen. |
| Scene editing | Clicking a body selected it, but placing it required entering coordinates. | Dragging moves a body in X–Z, and Height mode adjusts Y. A drag commits one undo step. Desktop and narrow-screen checks confirmed the inspector updates, and desktop checks confirmed that Undo restores the original values. |
| Camera and run state | A drag gesture only orbited the camera, and users had no cue about when a part could be repositioned. | Drag empty space to orbit and drag a part to place it. The viewport tells users to reset once a run has advanced. The inspector remains available for exact dimensions and positions. |
| Tool discovery | The compact toolbar exposed Add part, Templates and Outline through icons and accessible names. Their purpose was hard to infer visually. | The same tools now carry visible labels on desktop and in the bottom toolbar. Stress tools use the same treatment. |
| Stress | The home examples already led to the correct cases and the workspace labelled solver and model provenance. | The reference maps and direct case links carry through the new homepage. Stress geometry remains editable through its hole handles and numeric controls. |

## Performance findings

- The old hero WebP was 509,902 bytes. Its desktop replacement is 57,720 bytes (89% smaller),
  and the narrower variant is 21,184 bytes. These are file sizes before HTTP transfer
  encoding. The browser selects one hero variant. The three new experiment images total
  28,962 bytes and load lazily.
- The Motion renderer used to schedule an animation callback continuously, including when
  the tab showed Stress. It now requests frames while a run, drag, camera motion or view
  update needs one. Switching studies stops the Motion frame loop. Setting a new simulation
  instance for the same scene reuses its meshes.
- The headless preview used for plots and stop events previously ran its entire step loop
  on the UI thread in one pass. It now yields during longer previews and can cancel an
  obsolete preview. The run controls wait for its stop plan before starting playback. The
  deterministic test checks the same run identity, samples and stop event with and without
  the browser scheduling path.
- Motion sweeps cap concurrent Rapier workers at four and leave a logical processor for
  the UI when possible. This limits simultaneous memory use. A many-core machine can take
  longer on large sweeps than it did with the previous worker policy.
- Initial study downloads still dominate after the home page. The production output reports
  1.67 MB gzip for the Rapier chunk. The five stress model files total 23.2 MB before transfer
  encoding, and the ONNX runtime WASM is 3.20 MB gzip. These resources are loaded when the
  relevant study opens. The first FEM request also loads Pyodide and numerical packages.

This review measured asset sizes and verified interactions. It did not measure Core Web
Vitals, frame rates under CPU throttling, or timings across a device fleet.
