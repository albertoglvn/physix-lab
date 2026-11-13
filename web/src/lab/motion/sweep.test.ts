import { describe, expect, it } from "vitest";
import { fitExpression, presetById } from "../data/fit";
import { readingUncertainty } from "../data/noise";
import { makeObject, makeScene, type Block } from "../scene";
import { TIME_STEP } from "../simulation";
import { defaultProtocol, startingRamp } from "./probes";
import {
  applySweepValue,
  fitData,
  MAX_READINGS,
  metricOption,
  parseSweepSpec,
  readingsFor,
  sweepMetrics,
  sweepValueOf,
  sweepValues,
  sweepVariables,
  type SweepSpec,
} from "./sweep";
import {
  localRunner,
  poolSize,
  runSweep,
  type PointRunner,
  type SweepRecord,
} from "./sweepPool";
import { suggestedModel } from "./SweepData";
import { defaultSweepForm } from "./sweepForm";
import { fitSweep } from "./sweepFit";
import { referencesFor } from "./theory";

const incline = makeScene("incline");

const inclineSpec = (overrides: Partial<SweepSpec> = {}): SweepSpec => ({
  variable: "ramp-1.angle",
  values: sweepValues(20, 50, 2),
  metric: { kind: "reference", id: "block-1.incline.a" },
  repeats: 1,
  seed: 2026,
  noise: null,
  protocol: defaultProtocol(incline),
  timeStep: TIME_STEP,
  ...overrides,
});

describe("sweep variables", () => {
  it("lists scene and part variables, without the free-flight fields of a block on a ramp", () => {
    const paths = sweepVariables(incline).map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "gravity",
        "floorFriction",
        "ramp-1.angle",
        "ramp-1.friction",
        "ramp-1.length",
        "block-1.mass",
        "block-1.size",
      ]),
    );
    expect(paths).not.toContain("block-1.y");
    expect(paths).not.toContain("block-1.vx");
    expect(
      sweepVariables(makeScene("projectile")).map((item) => item.path),
    ).toContain("block-1.vx");
  });

  it("keeps a block on its ramp when the angle, length or block size changes", () => {
    for (const [path, value] of [
      ["ramp-1.angle", 42],
      ["ramp-1.length", 9],
      ["block-1.size", 1.4],
    ] as const) {
      const varied = applySweepValue(incline, path, value);
      expect(sweepValueOf(varied, path)).toBe(value);
      const block = varied.objects.find(
        (part): part is Block => part.id === "block-1" && part.kind === "block",
      )!;
      const start = startingRamp(block, varied);
      expect(start?.ramp.id).toBe("ramp-1");
      expect(start?.fraction).toBeCloseTo(0.23, 9);
      expect(
        referencesFor(varied).some((ref) => ref.id === "block-1.incline.a"),
      ).toBe(true);
    }
  });

  it("refuses unknown variables and values outside the scene limits", () => {
    expect(() => applySweepValue(incline, "ramp-9.angle", 30)).toThrow(
      /not a variable/,
    );
    expect(() => applySweepValue(incline, "ramp-1.angle", 80)).toThrow(
      /between 5 and 55 deg/,
    );
    expect(() => applySweepValue(incline, "gravity", Number.NaN)).toThrow(
      RangeError,
    );
  });

  it("spaces values evenly without floating-point drift", () => {
    expect(sweepValues(20, 50, 2)).toHaveLength(16);
    expect(sweepValues(0, 0.3, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(sweepValues(1, 0, -0.5)).toEqual([1, 0.5, 0]);
    expect(sweepValues(0, 1, 0.3)).toEqual([0, 0.3, 0.6, 0.9]);
    expect(sweepValues(3, 3, 1)).toEqual([3]);
    expect(() => sweepValues(0, 1, -0.1)).toThrow(/step/);
    expect(() => sweepValues(0, 1000, 1)).toThrow(/at most 200/);
  });
});

describe("sweep metrics and specs", () => {
  it("offers references, probe statistics and the stop time", () => {
    const options = sweepMetrics(incline);
    expect(options[0].metric).toEqual({
      kind: "reference",
      id: "block-1.incline.a",
    });
    expect(
      metricOption(incline, {
        kind: "probe",
        key: "block-1.speed",
        stat: "max",
      })?.unit,
    ).toBe("m/s");
    expect(metricOption(incline, { kind: "stop_time" })?.unit).toBe("s");
  });

  it("validates a spec against its scene", () => {
    const spec = inclineSpec();
    expect(parseSweepSpec(JSON.parse(JSON.stringify(spec)), incline)).toEqual(
      spec,
    );
    const bad = (overrides: Record<string, unknown>) => () =>
      parseSweepSpec({ ...spec, ...overrides }, incline);
    expect(bad({ repeats: 3 })).toThrow(/need synthetic noise/);
    expect(bad({ repeats: 30, noise: { sigma: 0.1, resolution: 0 } })).toThrow(
      /1 to 20/,
    );
    expect(
      bad({
        values: sweepValues(5, 55, 0.5),
        repeats: 5,
        noise: { sigma: 0.1, resolution: 0 },
      }),
    ).toThrow(new RegExp(`${MAX_READINGS} or fewer`));
    expect(bad({ seed: -1 })).toThrow(/seed/);
    expect(bad({ values: [60] })).toThrow(/between 5 and 55/);
    expect(
      bad({ metric: { kind: "reference", id: "pulley-1.atwood.a" } }),
    ).toThrow(/does not apply/);
    expect(bad({ noise: { sigma: 0, resolution: 0 } })).toThrow(/noise off/);
    expect(bad({ timeStep: 1 })).toThrow(/time step/);
  });

  it("draws the same readings for a seed, point and repeat, whatever the order", () => {
    const spec = {
      noise: { sigma: 0.05, resolution: 0 },
      repeats: 4,
      seed: 7,
    };
    const a = readingsFor(spec, 3, 2.5);
    readingsFor(spec, 0, 1);
    expect(readingsFor(spec, 3, 2.5)).toEqual(a);
    expect(new Set(a).size).toBe(4);
    expect(readingsFor({ ...spec, seed: 8 }, 3, 2.5)).not.toEqual(a);
    expect(readingsFor({ ...spec, noise: null }, 3, 2.5)).toEqual([]);
  });
});

const withoutTiming = (record: SweepRecord) =>
  record.points.map((point) => ({ ...point, wallMs: 0 }));

describe("running sweeps", () => {
  it("gives the same points on one runner or several", async () => {
    const spec = inclineSpec({
      values: sweepValues(20, 45, 5),
      repeats: 3,
      noise: { sigma: 0.05, resolution: 0.001 },
    });
    const progress: number[] = [];
    const one = await runSweep(incline, spec, {
      runners: [localRunner()],
      onPoint: ({ done }) => progress.push(done),
    });
    const three = await runSweep(incline, spec, {
      runners: [localRunner(), localRunner(), localRunner()],
    });
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    expect(one.status).toBe("complete");
    expect(three.id).toBe(one.id);
    expect(withoutTiming(three)).toEqual(withoutTiming(one));
    expect(one.points.map((point) => point.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(one.timing.runners).toBe(1);
  });

  it("keeps the finished points when cancelled", async () => {
    const controller = new AbortController();
    const record = await runSweep(incline, inclineSpec(), {
      runners: [localRunner()],
      signal: controller.signal,
      onPoint: ({ done }) => {
        if (done === 3) controller.abort();
      },
    });
    expect(record.status).toBe("cancelled");
    expect(record.points.map((point) => point.index)).toEqual([0, 1, 2]);
  });

  it("records a failed point instead of losing the sweep", async () => {
    const flaky: PointRunner = {
      run: async (task) => {
        if (task.index === 1) throw new Error("engine crashed");
        return localRunner().run(task);
      },
      dispose: () => {},
    };
    const record = await runSweep(
      incline,
      inclineSpec({ values: [20, 30, 40] }),
      { runners: [flaky] },
    );
    expect(record.status).toBe("complete");
    expect(record.points[1].value).toBeNaN();
    expect(record.points[1].note).toBe("engine crashed");
  });

  it("sizes the pool to leave one processor free", () => {
    expect(poolSize(8)).toBe(7);
    expect(poolSize(1)).toBe(1);
    expect(poolSize(0)).toBe(1);
  });

  it("reads the stop time", async () => {
    const friction = makeScene("friction");
    const record = await runSweep(
      friction,
      {
        variable: "floorFriction",
        values: [0.2, 0.4, 0.6],
        metric: { kind: "stop_time" },
        repeats: 1,
        seed: 0,
        noise: null,
        protocol: defaultProtocol(friction),
        timeStep: TIME_STEP,
      },
      { runners: [localRunner()] },
    );
    for (const point of record.points)
      // v₀ / (μ g), within the rest threshold and a probe sample.
      expect(point.value).toBeCloseTo(5 / (point.x * 9.81), 1);
  });
});

describe("Phase 3 exit criteria", () => {
  it("recovers μ from the incline angle within the fitted uncertainty", async () => {
    // Configured μ = 0.2. Sixteen angles, three synthetic readings each, σ = 0.05 m/s²
    // and a 0.001 m/s² resolution. The criterion is |μ̂ − 0.2| ≤ 2 SE.
    const noise = { sigma: 0.05, resolution: 0.001 };
    const record = await runSweep(incline, inclineSpec({ repeats: 3, noise }), {
      runners: [localRunner()],
    });
    const preset = presetById("incline")!;
    const noisy = fitData(record.points, true);
    expect(noisy.xs).toHaveLength(48);
    const { result } = fitExpression(preset.expression, noisy.xs, noisy.ys, {
      constants: { g: incline.gravity },
      preset,
      sigma: readingUncertainty(noise),
    });
    const [mu] = result.parameters;
    expect(Math.abs(mu.value - 0.2)).toBeLessThanOrEqual(2 * mu.se);
    expect(mu.se).toBeGreaterThan(1e-4);
    expect(mu.se).toBeLessThan(5e-3);
    expect(result.reducedChi2).toBeGreaterThan(0.5);
    expect(result.reducedChi2).toBeLessThan(1.6);
    // The clean runs pin μ to the simulation's own accuracy.
    const clean = fitData(record.points, false);
    const exact = fitExpression(preset.expression, clean.xs, clean.ys, {
      constants: { g: incline.gravity },
      preset,
    }).result.parameters[0];
    expect(exact.value).toBeCloseTo(0.2, 5);
  });

  it("matches the ideal Atwood formula across a mass sweep", async () => {
    const pulley = makeScene("pulley");
    const record = await runSweep(
      pulley,
      {
        variable: "pulley-1.rightMass",
        values: sweepValues(1, 5, 0.5),
        metric: { kind: "reference", id: "pulley-1.atwood.a" },
        repeats: 1,
        seed: 0,
        noise: null,
        protocol: defaultProtocol(pulley),
        timeStep: TIME_STEP,
      },
      { runners: [localRunner()] },
    );
    expect(record.points).toHaveLength(9);
    for (const point of record.points)
      expect(Math.abs(point.value - point.theory!)).toBeLessThan(1e-6);
  });
});

describe("Phase 3 oscillator sweeps", () => {
  const pendulum = {
    ...makeScene("pendulum"),
    objects: [
      {
        ...makeObject("pendulum", "pendulum-1"),
        angle: 3,
        bobRadius: 0.05,
      },
    ],
  };
  const lengthSpec = (overrides: Partial<SweepSpec> = {}): SweepSpec => ({
    variable: "pendulum-1.length",
    values: sweepValues(1.5, 4.5, 0.25),
    metric: { kind: "reference", id: "pendulum-1.pendulum.T" },
    repeats: 1,
    seed: 2026,
    noise: null,
    protocol: defaultProtocol(pendulum),
    timeStep: TIME_STEP,
    ...overrides,
  });

  it("recovers g from a pendulum length sweep within the fitted uncertainty", async () => {
    // Thirteen lengths, three synthetic readings each, σ = 0.01 s and a 1 ms resolution.
    // The model 2π √(L/g) leaves out the 3° amplitude and the bob's own inertia, which
    // together lower ĝ by about 0.05 %; the criterion is |ĝ − g| ≤ 2 SE.
    const noise = { sigma: 0.01, resolution: 0.001 };
    const spec = lengthSpec({ repeats: 3, noise });
    const record = await runSweep(pendulum, spec, {
      runners: [localRunner()],
    });
    expect(suggestedModel(spec)).toBe("pendulum");
    const fit = fitSweep(pendulum, spec, record.points, "pendulum", "");
    const [g] = fit.result.parameters;
    expect(g.name).toBe("g");
    expect(Math.abs(g.value - 9.81)).toBeLessThanOrEqual(2 * g.se);
    expect(g.se).toBeLessThan(0.03);
    expect(fit.known.g).toEqual({ value: 9.81, source: "Scene gravity" });
    // Each clean run matches the exact period, so the clean fit shows only the model bias.
    for (const point of record.points)
      expect(Math.abs(point.value / point.theory! - 1)).toBeLessThan(1e-5);
    const clean = fitSweep(
      pendulum,
      { ...spec, noise: null, repeats: 1 },
      record.points,
      "pendulum",
      "",
    ).result.parameters[0];
    expect(Math.abs(clean.value / 9.81 - 1)).toBeLessThan(1e-3);
  });

  it("recovers k from a spring mass sweep", async () => {
    const spring = makeScene("spring");
    const spec: SweepSpec = {
      variable: "spring-1.mass",
      values: sweepValues(0.5, 3, 0.5),
      metric: { kind: "reference", id: "spring-1.spring.T" },
      repeats: 1,
      seed: 0,
      noise: null,
      protocol: defaultProtocol(spring),
      timeStep: TIME_STEP,
    };
    const record = await runSweep(spring, spec, { runners: [localRunner()] });
    expect(suggestedModel(spec)).toBe("spring");
    const fit = fitSweep(spring, spec, record.points, "spring", "");
    expect(fit.result.parameters[0].value / 80 - 1).toBeLessThan(5e-3);
    expect(fit.known.k).toEqual({ value: 80, source: "spring-1 stiffness" });
  });

  it("reads a period from any probe and rejects lengths that reach the floor", async () => {
    const [point] = (
      await runSweep(
        pendulum,
        lengthSpec({
          values: [2],
          metric: { kind: "probe", key: "pendulum-1.x", stat: "period" },
        }),
        { runners: [localRunner()] },
      )
    ).points;
    const T = 2 * Math.PI * Math.sqrt((4 + 0.4 * 0.05 ** 2) / (9.81 * 2));
    expect(point.value / T - 1).toBeLessThan(1e-3);
    expect(() => applySweepValue(pendulum, "pendulum-1.length", 6)).toThrow(
      "floor",
    );
    const form = defaultSweepForm(pendulum, 1);
    expect(form.variable).toBe("pendulum-1.length");
    expect(Number(form.to)).toBeLessThanOrEqual(4.95);
    expect(
      sweepValues(Number(form.from), Number(form.to), Number(form.step)).length,
    ).toBeGreaterThan(5);
  });
});
