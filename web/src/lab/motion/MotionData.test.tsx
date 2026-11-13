import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { makeObject, makeScene } from "../scene";
import {
  MotionData,
  overlayColours,
  probeTarget,
  revealTime,
  seriesColour,
  type MotionDataProps,
  type RunHistoryControls,
} from "./MotionData";
import { defaultProtocol, SYSTEM } from "./probes";
import { runProtocol, type MotionRun } from "./run";
import { compare, curvesFor, referencesFor } from "./theory";

const scene = makeScene("incline");
let run: MotionRun;

beforeAll(async () => {
  run = await runProtocol(scene, defaultProtocol(scene));
});

const props = (overrides: Partial<MotionDataProps> = {}): MotionDataProps => ({
  scene,
  target: "block-1",
  run,
  time: 0,
  comparisons: referencesFor(scene).map((reference) => compare(reference, run)),
  curves: curvesFor(scene),
  onCheck: () => {},
  onExport: () => {},
  ...overrides,
});

describe("motion data helpers", () => {
  it("probes the selected body, or the system for ramps and the scene", () => {
    expect(probeTarget(scene, "block-1")).toBe("block-1");
    expect(probeTarget(scene, "ramp-1")).toBe(SYSTEM);
    expect(probeTarget(scene, null)).toBe(SYSTEM);
  });

  it("gives bodies series colours in creation order", () => {
    const busy = makeScene("incline");
    busy.objects.push(makeObject("pulley", "pulley-1", 6));
    expect(seriesColour(busy, "block-1")).toBe("var(--px-series-1)");
    expect(seriesColour(busy, "pulley-1")).toBe("var(--px-series-2)");
    expect(seriesColour(busy, SYSTEM)).toBe("var(--px-series-1)");
  });

  it("reveals a result when the run reaches its event", () => {
    const [acceleration, time] = referencesFor(scene);
    expect(revealTime(time, run)).toBe(run.stop.t);
    expect(revealTime(acceleration, run)).toBe(run.stop.t);
  });
});

describe("motion data dock", () => {
  it("keeps results pending until the live run reaches them", () => {
    const html = renderToStaticMarkup(<MotionData {...props()} />);
    expect(html).toContain("Pending");
    expect(html).not.toContain("Δ ");
    expect(html).toContain("Speed (m/s)");
    expect(html).toContain("lab-plot-ref");
  });

  it("shows each difference with its tolerance tone after the event", () => {
    const html = renderToStaticMarkup(
      <MotionData {...props({ time: run.stop.t })} />,
    );
    expect(html).not.toContain("Pending");
    expect(html.match(/data-tone="ok"[^>]*>Δ /g)).toHaveLength(4);
    expect(html).toContain("a = g (sin θ − μ cos θ)");
  });

  it("flags a broken assumption instead of a difference", () => {
    const comparisons = props().comparisons.map((comparison) => ({
      ...comparison,
      reference: { ...comparison.reference, broken: "block-2 shares ramp-1." },
    }));
    const html = renderToStaticMarkup(
      <MotionData {...props({ comparisons, time: run.stop.t })} />,
    );
    expect(html).toContain("Assumption broken");
    expect(html).toContain('title="block-2 shares ramp-1."');
  });

  it("reports the step check and run errors", () => {
    const [reference] = referencesFor(scene);
    const checking = renderToStaticMarkup(
      <MotionData {...props({ check: { reference } })} />,
    );
    expect(checking).toContain("Checking acceleration at three step sizes");
    const done = renderToStaticMarkup(
      <MotionData
        {...props({
          check: {
            reference,
            result: {
              referenceId: reference.id,
              label: reference.label,
              unit: reference.unit,
              steps: [1 / 120, 1 / 240, 1 / 480],
              values: [2.5, 2.5, 2.5],
              change: 0.00002,
              order: 0.58,
              tolerance: 0.01,
              passed: true,
            },
          },
        })}
      />,
    );
    expect(done).toContain("Converged");
    expect(done).toContain("order 0.58");
    const failed = renderToStaticMarkup(
      <MotionData {...props({ run: undefined, runError: "Engine failed." })} />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Engine failed.");
  });
});

describe("run history chips", () => {
  const history = (
    overrides: Partial<RunHistoryControls> = {},
  ): RunHistoryControls => ({
    runs: [],
    compared: [],
    onKeep: () => {},
    onToggle: () => {},
    onPin: () => {},
    onRemove: () => {},
    onRecheck: () => {},
    ...overrides,
  });
  const stored = (id: string, gravity: number, pinned = false) => {
    const copy = structuredClone(run);
    copy.id = id;
    copy.inputs.scene.gravity = gravity;
    return { run: copy, savedAt: 1, pinned };
  };

  it("offers to keep the live run until it is kept", () => {
    const empty = renderToStaticMarkup(
      <MotionData {...props({ history: history() })} />,
    );
    expect(empty).toContain("Keep run");
    expect(empty).toContain("Finished runs are kept here.");
    const kept = renderToStaticMarkup(
      <MotionData
        {...props({
          history: history({
            runs: [{ run, savedAt: 1, pinned: false }],
          }),
        })}
      />,
    );
    expect(kept).toContain("Kept");
    expect(kept).toContain("This run");
  });

  it("overlays the baseline and compared runs in palette colours", () => {
    const html = renderToStaticMarkup(
      <MotionData
        {...props({
          history: history({
            runs: [
              stored("sha256:moon", 1.62, true),
              stored("sha256:mars", 3.71),
              stored("sha256:idle", 5),
            ],
            compared: ["sha256:mars"],
            checking: "sha256:mars",
          }),
        })}
      />,
    );
    expect(html.match(/lab-plot-line--overlay/g)).toHaveLength(2);
    expect(html).toContain("Baseline · g 1.62");
    expect(html).toContain("g 3.71");
    expect(html).toContain("g 5");
    // The live run keeps series 1; the baseline and comparison take the next colours.
    expect(html).toContain("stroke:var(--px-series-2)");
    expect(html).toContain("stroke:var(--px-series-3)");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Unpin baseline"');
    expect(html.match(/aria-label="Re-run and check"/g)).toHaveLength(3);
    expect(html).toMatch(
      /disabled=""[^>]*aria-label="Re-run and check"|aria-label="Re-run and check"[^>]*disabled=""/,
    );
  });

  it("hides the chips outside the plot view", () => {
    const html = renderToStaticMarkup(
      <MotionData {...props({ view: "table", history: history() })} />,
    );
    expect(html).not.toContain("Keep run");
  });

  it("leaves the palette's other colours for comparisons", () => {
    expect(overlayColours("var(--px-series-2)")).toEqual([
      "var(--px-series-1)",
      "var(--px-series-3)",
      "var(--px-series-4)",
      "var(--px-series-5)",
      "var(--px-series-6)",
    ]);
  });
});
