import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { makeObject, makeScene } from "../scene";
import {
  MotionData,
  probeTarget,
  revealTime,
  seriesColour,
  type MotionDataProps,
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
    expect(html.match(/data-tone="ok"[^>]*>Δ /g)).toHaveLength(2);
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
