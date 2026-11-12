import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SweepPlot, xRange } from "../data/SweepPlot";
import { makeScene } from "../scene";
import { TIME_STEP } from "../simulation";
import { MotionData } from "./MotionData";
import { defaultProtocol } from "./probes";
import { metricTarget, sweepValues, type SweepSpec } from "./sweep";
import {
  formatEstimate,
  suggestedModel,
  SweepData,
  sweepAxes,
} from "./SweepData";
import { fitSweep, knownParameters } from "./sweepFit";
import {
  defaultRange,
  defaultSweepForm,
  defaultVariable,
  formForVariable,
  formToSpec,
  reconcileForm,
} from "./sweepForm";
import { localRunner, runSweep, type SweepRecord } from "./sweepPool";
import type { SweepState } from "./useSweep";

const incline = makeScene("incline");
const protocol = defaultProtocol(incline);

describe("sweep form", () => {
  it("starts from the template's main variable over round steps", () => {
    const form = defaultSweepForm(incline, 7);
    expect(form).toMatchObject({
      variable: "ramp-1.angle",
      from: "5",
      to: "55",
      step: "5",
      metric: "reference:block-1.incline.a",
      noise: false,
      seed: "7",
    });
    expect(defaultVariable(makeScene("pulley"))).toBe("pulley-1.rightMass");
    expect(defaultVariable(makeScene("friction"))).toBe("floorFriction");
    expect(defaultVariable(makeScene("projectile"))).toBe("block-1.vx");
    expect(defaultRange(0, 2)).toEqual({ from: 0, to: 2, step: 0.2 });
  });

  it("converts to a validated spec and explains bad input", () => {
    const form = defaultSweepForm(incline, 7);
    const { spec } = formToSpec(form, incline, protocol);
    expect(spec?.values).toEqual(sweepValues(5, 55, 5));
    expect(spec?.repeats).toBe(1);
    expect(spec?.noise).toBeNull();
    expect(formToSpec({ ...form, step: "x" }, incline, protocol).error).toMatch(
      /Step must be a number/,
    );
    expect(formToSpec({ ...form, to: "80" }, incline, protocol).error).toMatch(
      /between 5 and 55/,
    );
    expect(
      formToSpec({ ...form, step: "0.1" }, incline, protocol).error,
    ).toMatch(/at most 200/);
    const noisy = formToSpec(
      { ...form, noise: true, sigma: "0.05", repeats: "3" },
      incline,
      protocol,
    );
    expect(noisy.spec?.noise).toEqual({ sigma: 0.05, resolution: 0.001 });
    expect(noisy.spec?.repeats).toBe(3);
    expect(
      formToSpec(
        { ...form, noise: true, sigma: "0", resolution: "0" },
        incline,
        protocol,
      ).error,
    ).toMatch(/turn noise off/);
  });

  it("resets the range for a new variable and survives scene changes", () => {
    const form = defaultSweepForm(incline, 7);
    expect(formForVariable(incline, form, "ramp-1.friction")).toMatchObject({
      from: "0",
      to: "2",
      step: "0.2",
      metric: form.metric,
    });
    const pulley = makeScene("pulley");
    const kept = reconcileForm(pulley, form);
    expect(kept.variable).toBe("pulley-1.rightMass");
    expect(kept.metric).toBe("reference:pulley-1.atwood.a");
    expect(reconcileForm(incline, form)).toBe(form);
  });
});

let record: SweepRecord;
const spec: SweepSpec = {
  variable: "ramp-1.angle",
  values: sweepValues(20, 50, 5),
  metric: { kind: "reference", id: "block-1.incline.a" },
  repeats: 3,
  seed: 11,
  noise: { sigma: 0.05, resolution: 0.001 },
  protocol,
  timeStep: TIME_STEP,
};

beforeAll(async () => {
  record = await runSweep(incline, spec, { runners: [localRunner()] });
});

const state = (overrides: Partial<SweepState> = {}): SweepState => ({
  scene: incline,
  spec,
  points: record.points,
  status: "complete",
  record,
  runners: 1,
  serial: 1,
  ...overrides,
});

describe("sweep fit", () => {
  it("fits the readings with their σ and checks μ against the ramp", () => {
    const fit = fitSweep(incline, spec, record.points, "incline", "");
    const [mu] = fit.result.parameters;
    expect(fit.result.n).toBe(21);
    expect(fit.sigma).toBeCloseTo(Math.hypot(0.05, 0.001 / Math.sqrt(12)), 12);
    expect(fit.known.mu).toEqual({ value: 0.2, source: "ramp-1 friction" });
    expect(Math.abs(mu.value - 0.2)).toBeLessThan(3 * mu.se);
    expect(fit.curve.band(30)).toBeGreaterThan(0);
    expect(fit.curve.at(30)).toBeCloseTo(
      9.81 * (Math.sin(Math.PI / 6) - mu.value * Math.cos(Math.PI / 6)),
      9,
    );
  });

  it("fits clean values without weights and a custom expression", () => {
    const clean = { ...spec, noise: null, repeats: 1 };
    const fit = fitSweep(incline, clean, record.points, "custom", "a + b*x");
    expect(fit.result.reducedChi2).toBeUndefined();
    expect(fit.result.n).toBe(7);
    expect(fit.known).toEqual({});
    expect(() =>
      fitSweep(incline, clean, record.points, "custom", "a +"),
    ).toThrow(/ends too early/);
  });

  it("knows μ only for incline references, and not while sweeping it", () => {
    expect(knownParameters(incline, spec).mu?.value).toBe(0.2);
    expect(
      knownParameters(incline, { ...spec, variable: "ramp-1.friction" }),
    ).toEqual({});
    expect(
      knownParameters(incline, { ...spec, metric: { kind: "stop_time" } }),
    ).toEqual({});
  });

  it("rounds an estimate to two significant digits of its error", () => {
    expect(formatEstimate(0.19934, 0.0021)).toBe("0.1993 ± 0.0021");
    expect(formatEstimate(123.456, 12)).toBe("123 ± 12");
    expect(formatEstimate(1.5, 0)).toBe("1.5");
    expect(formatEstimate(Number.NaN, 1)).toBe("—");
  });

  it("suggests the incline law for an angle sweep of its acceleration", () => {
    expect(suggestedModel(spec)).toBe("incline");
    expect(suggestedModel({ ...spec, variable: "block-1.mass" })).toBe(
      "linear",
    );
    expect(metricTarget(spec.metric)).toBe("block-1");
    expect(metricTarget({ kind: "stop_time" })).toBe("system");
  });
});

describe("sweep plot and view", () => {
  const axes = sweepAxes(incline, spec);
  const points = () =>
    record.points.map(({ x, value, readings, theory }) => ({
      x,
      value,
      readings,
      theory,
    }));

  it("draws filled values, hollow readings, the theory line and a fit band", () => {
    const fit = fitSweep(incline, spec, record.points, "incline", "");
    const html = renderToStaticMarkup(
      <SweepPlot
        points={points()}
        xAxis={axes.x}
        yAxis={axes.y}
        domain={[20, 50]}
        color="var(--px-series-1)"
        fit={fit.curve}
      />,
    );
    expect(html.match(/<circle/g)).toHaveLength(7 + 21);
    expect(html).toContain('class="lab-plot-readings"');
    expect(html).toContain('class="lab-plot-band"');
    expect(html).toContain('class="lab-plot-ref"');
    expect(html).toContain("Synthetic readings");
    expect(html).toContain("Fit ± 2 SE");
    expect(html).toContain("ramp-1 angle (deg)");
    expect(html).toMatch(
      /aria-label="Acceleration[^"]*7 points with synthetic readings/,
    );
  });

  it("pads the swept range so end markers clear the frame", () => {
    expect(xRange([20, 50])).toEqual([18.8, 51.2]);
    expect(xRange([3, 3])).toEqual([2.5, 3.5]);
  });

  const render = (overrides: Partial<SweepState> | null) =>
    renderToStaticMarkup(
      <SweepData
        state={overrides === null ? undefined : state(overrides)}
        scene={incline}
        color="var(--px-series-1)"
        switcher={<span>switch</span>}
        onSetup={() => {}}
        onCancel={() => {}}
        onExport={() => {}}
        onFit={() => {}}
      />,
    );

  it("shows progress, a cancel button and the synthetic-noise chip while running", () => {
    const html = render({
      status: "running",
      points: record.points.slice(0, 3),
      record: undefined,
    });
    expect(html).toContain("3 / 7 points");
    expect(html).toContain("Cancel");
    expect(html).toContain("Synthetic noise · σ 0.05 m/s²");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*Fit<\/button>/);
  });

  it("offers the fit once the sweep ends, with its result", () => {
    const fit = fitSweep(incline, spec, record.points, "incline", "");
    const html = render({ fit });
    expect(html).toContain("Sweep setup");
    expect(html).toContain("μ");
    expect(html).toContain("Within 2 SE of");
    expect(html).toContain("χ²/dof");
    expect(html).not.toContain("Earlier scene");
    expect(render({ scene: structuredClone(incline) })).not.toContain(
      "Earlier scene",
    );
    expect(render({ scene: makeScene("friction") })).toContain("Earlier scene");
    expect(
      render({ status: "cancelled", points: record.points.slice(0, 2) }),
    ).toContain("Cancelled at 2 / 7");
  });

  it("explains an empty sweep view", () => {
    expect(render(null)).toContain("Vary one input across a range");
  });

  it("adds a Sweep option to the dock only when the study renders one", () => {
    const base = {
      scene: incline,
      target: "block-1",
      time: 0,
      comparisons: [],
      curves: [],
      onCheck: () => {},
      onExport: () => {},
    };
    expect(renderToStaticMarkup(<MotionData {...base} />)).not.toContain(
      ">Sweep<",
    );
    const html = renderToStaticMarkup(
      <MotionData
        {...base}
        view="sweep"
        renderSweep={(switcher) => <div id="sweep">{switcher}</div>}
      />,
    );
    expect(html).toContain('id="sweep"');
    expect(html).toContain(">Sweep<");
  });
});
