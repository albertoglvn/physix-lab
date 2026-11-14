import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { noisyReading } from "../data/noise";
import { stream } from "../data/random";
import { SweepPlot } from "../data/SweepPlot";
import { makeObject, makeScene, type LabScene } from "../scene";
import { TIME_STEP } from "../simulation";
import { defaultProtocol } from "./probes";
import {
  MAX_SWEEP_RUNS,
  parseSweepSpec,
  perturbationVariables,
  perturbedInput,
  pointCount,
  readingsFor,
  runCount,
  sceneAt,
  sweepCoordinates,
  sweepValueOf,
  sweepValues,
  sweepVariables,
  type SweepSpec,
} from "./sweep";
import { gridSlices, sliceIndices, SLICE_LIMIT, sweepAxes } from "./SweepData";
import {
  parseSweepRecord,
  SWEEP_CSV_COLUMNS,
  sweepMethods,
  sweepToCsv,
} from "./sweepExport";
import { fitSweep } from "./sweepFit";
import { defaultSweepForm, formToSpec, reconcileForm } from "./sweepForm";
import {
  localRunner,
  runSweep,
  sweepIdentity,
  type SweepRecord,
} from "./sweepPool";

const pendulum: LabScene = {
  ...makeScene("pendulum"),
  objects: [
    { ...makeObject("pendulum", "pendulum-1"), angle: 10, bobRadius: 0.05 },
  ],
};

const gridSpec = (overrides: Partial<SweepSpec> = {}): SweepSpec => ({
  variable: "pendulum-1.length",
  values: sweepValues(1.5, 2.5, 0.5),
  second: { variable: "pendulum-1.angle", values: [10, 30] },
  metric: { kind: "reference", id: "pendulum-1.pendulum.T" },
  repeats: 1,
  seed: 2026,
  noise: null,
  protocol: defaultProtocol(pendulum),
  timeStep: TIME_STEP,
  ...overrides,
});

const withoutTiming = (record: SweepRecord) => ({
  ...record,
  timing: undefined,
  points: record.points.map((point) => ({ ...point, wallMs: 0 })),
});

describe("sweep grids", () => {
  it("enumerates every pair row-major and applies both values", () => {
    const spec = gridSpec();
    expect(pointCount(spec)).toBe(6);
    expect(
      Array.from({ length: 6 }, (_, index) => sweepCoordinates(spec, index)),
    ).toEqual([
      { x: 1.5, x2: 10 },
      { x: 1.5, x2: 30 },
      { x: 2, x2: 10 },
      { x: 2, x2: 30 },
      { x: 2.5, x2: 10 },
      { x: 2.5, x2: 30 },
    ]);
    const varied = sceneAt(pendulum, spec, 3);
    expect(sweepValueOf(varied, "pendulum-1.length")).toBe(2);
    expect(sweepValueOf(varied, "pendulum-1.angle")).toBe(30);
    const line = { ...spec, second: undefined };
    expect(pointCount(line)).toBe(3);
    expect(sweepCoordinates(line, 2)).toEqual({ x: 2.5 });
  });

  it("caps a grid at 400 points and checks its second axis", () => {
    const axis = (count: number) =>
      Array.from({ length: count }, (_, index) => 1.5 + index * 0.01);
    const angles = (count: number) =>
      Array.from({ length: count }, (_, index) => 1 + index);
    const accepted = parseSweepSpec(
      gridSpec({
        values: axis(20),
        second: { variable: "pendulum-1.angle", values: angles(20) },
      }),
      pendulum,
    );
    expect(pointCount(accepted)).toBe(MAX_SWEEP_RUNS);
    expect(() =>
      parseSweepSpec(
        gridSpec({
          values: axis(21),
          second: { variable: "pendulum-1.angle", values: angles(20) },
        }),
        pendulum,
      ),
    ).toThrow(/21 × 20 grid is 420 points/);
    expect(() =>
      parseSweepSpec(
        gridSpec({ second: { variable: "pendulum-1.length", values: [2] } }),
        pendulum,
      ),
    ).toThrow(/must differ/);
    expect(() =>
      parseSweepSpec(
        gridSpec({ second: { variable: "pendulum-1.angle", values: [500] } }),
        pendulum,
      ),
    ).toThrow(/between/);
    expect(() =>
      parseSweepSpec(
        gridSpec({ second: { variable: "nowhere.mass", values: [1] } }),
        pendulum,
      ),
    ).toThrow(/not a variable/);
  });

  it("keeps one-variable specs free of grid and perturbation fields", async () => {
    const line = { ...gridSpec(), second: undefined };
    const parsed = parseSweepSpec(line, pendulum);
    expect(Object.keys(parsed)).not.toContain("second");
    expect(Object.keys(parsed)).not.toContain("perturbation");
    // So a one-variable sweep keeps the identity it had before grids existed.
    expect(await sweepIdentity(pendulum, parsed)).toBe(
      await sweepIdentity(pendulum, line),
    );
  });

  it("slices a grid along its second variable, at most one per colour", () => {
    expect(sliceIndices(4)).toEqual([0, 1, 2, 3]);
    expect(sliceIndices(10)).toEqual([0, 2, 4, 5, 7, 9]);
    expect(sliceIndices(200)).toHaveLength(SLICE_LIMIT);
    const spec = gridSpec();
    const axes = sweepAxes(pendulum, spec);
    expect(axes.x2?.unit).toBe("deg");
    const points = [0, 1, 2, 3].map((index) => ({
      index,
      ...sweepCoordinates(spec, index),
      value: index,
      readings: [],
      runId: "",
      stop: { reason: "event" as const, t: 1 },
      wallMs: 0,
    }));
    const slices = gridSlices(spec, points, axes.x2!, "var(--px-series-3)");
    expect(slices.map((slice) => slice.label)).toEqual([
      "θ₀ = 10 deg",
      "θ₀ = 30 deg",
    ]);
    expect(slices.map((slice) => slice.color)).toEqual([
      "var(--px-series-3)",
      "var(--px-series-1)",
    ]);
    expect(slices[1].points.map((point) => point.value)).toEqual([1, 3]);
    const html = renderToStaticMarkup(
      <SweepPlot
        points={points}
        groups={slices}
        xAxis={axes.x}
        yAxis={axes.y}
        domain={[1.5, 2.5]}
        color="var(--px-series-3)"
      />,
    );
    expect(html.match(/lab-plot-line--overlay/g)).toHaveLength(2);
    expect(html).toContain("θ₀ = 30 deg");
    expect(html).toMatch(/aria-label="[^"]*4 points in 2 slices/);
  });

  it("refuses to fit a grid", () => {
    expect(() => fitSweep(pendulum, gridSpec(), [], "linear", "")).toThrow(
      /one swept variable/,
    );
  });
});

describe("perturbed starts", () => {
  it("offers only initial conditions", () => {
    expect(perturbationVariables(pendulum).map((item) => item.path)).toEqual([
      "pendulum-1.angle",
    ]);
    // A block on a ramp keeps its ramp placement, so it has nothing to perturb.
    expect(perturbationVariables(makeScene("incline"))).toEqual([]);
    const projectile = makeScene("projectile");
    const paths = perturbationVariables(projectile).map((item) => item.path);
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((path) => expect(path).toMatch(/\.(y|vx|vy)$/));
    expect(
      paths.every((path) =>
        sweepVariables(projectile).some((item) => item.path === path),
      ),
    ).toBe(true);
  });

  it("validates the perturbation, the repeats and the run budget", () => {
    const perturbation = { variable: "pendulum-1.angle", sigma: 1 };
    const repeated = parseSweepSpec(
      gridSpec({ perturbation, repeats: 3 }),
      pendulum,
    );
    expect(repeated.perturbation).toEqual(perturbation);
    expect(runCount(repeated)).toBe(6 * 4);
    expect(() => parseSweepSpec(gridSpec({ repeats: 3 }), pendulum)).toThrow(
      /noise or a perturbed start/,
    );
    expect(() =>
      parseSweepSpec(
        gridSpec({
          perturbation: { variable: "pendulum-1.mass", sigma: 1 },
        }),
        pendulum,
      ),
    ).toThrow(/Only a height/);
    expect(() =>
      parseSweepSpec(
        gridSpec({ perturbation: { ...perturbation, sigma: 0 } }),
        pendulum,
      ),
    ).toThrow(/positive/);
    // 100 points × (1 + 4 perturbed runs) is 500 runs.
    expect(() =>
      parseSweepSpec(
        {
          ...gridSpec({ perturbation, repeats: 4 }),
          values: sweepValues(1.5, 2.49, 0.01),
          second: undefined,
        },
        pendulum,
      ),
    ).toThrow(/500 runs/);
  });

  it("draws clamped inputs from their own stream", () => {
    const perturbation = { variable: "pendulum-1.angle", sigma: 2 };
    const range = { min: 1, max: 80 };
    const draws = Array.from({ length: 50 }, (_, repeat) =>
      perturbedInput(10, perturbation, range, 7, 3, repeat),
    );
    expect(new Set(draws).size).toBe(50);
    expect(perturbedInput(10, perturbation, range, 7, 3, 4)).toBe(draws[4]);
    expect(
      perturbedInput(1, { ...perturbation, sigma: 100 }, range, 7, 3, 0),
    ).toBeGreaterThanOrEqual(1);
    const wide = Array.from({ length: 20 }, (_, repeat) =>
      perturbedInput(40, { ...perturbation, sigma: 1e9 }, range, 7, 3, repeat),
    );
    expect(wide.every((value) => value === 1 || value === 80)).toBe(true);
    // Noise on a perturbed reading uses the noise stream, apart from the draw.
    const noise = { sigma: 0.01, resolution: 0 };
    expect(readingsFor({ noise, repeats: 2, seed: 7 }, 3, 0, [1, 2])).toEqual([
      noisyReading(1, noise, stream(7, 3, 0)),
      noisyReading(2, noise, stream(7, 3, 1)),
    ]);
    expect(
      readingsFor({ noise: null, repeats: 2, seed: 7 }, 3, 0, [1, 2]),
    ).toEqual([1, 2]);
  });

  describe("a perturbed grid run", () => {
    const spec = gridSpec({
      perturbation: { variable: "pendulum-1.angle", sigma: 1.5 },
      repeats: 2,
      noise: { sigma: 0.002, resolution: 0.001 },
    });
    let one: SweepRecord;
    let three: SweepRecord;
    beforeAll(async () => {
      one = await runSweep(pendulum, spec, { runners: [localRunner()] });
      three = await runSweep(pendulum, spec, {
        runners: [localRunner(), localRunner(), localRunner()],
      });
    });

    it("is the same on one runner or several", () => {
      expect(one.status).toBe("complete");
      expect(one.points).toHaveLength(6);
      expect(withoutTiming(three)).toEqual(withoutTiming(one));
    });

    it("reruns each point from its perturbed starts", () => {
      for (const point of one.points) {
        const base = point.x2!;
        expect(point.perturbed?.inputs).toEqual(
          [0, 1].map((repeat) =>
            perturbedInput(
              base,
              spec.perturbation!,
              { min: 1, max: 80 },
              spec.seed,
              point.index,
              repeat,
            ),
          ),
        );
        expect(point.readings).toEqual(
          readingsFor(spec, point.index, point.value, point.perturbed!.values),
        );
        // A degree or two changes a pendulum's period only slightly.
        for (const value of point.perturbed!.values)
          expect(Math.abs(value - point.value) / point.value).toBeLessThan(
            0.01,
          );
      }
      // A longer pendulum swings more slowly, at either amplitude.
      const at = (x: number, x2: number) =>
        one.points.find((point) => point.x === x && point.x2 === x2)!.value;
      expect(at(2.5, 10)).toBeGreaterThan(at(1.5, 10));
      expect(at(1.5, 30)).toBeGreaterThan(at(1.5, 10));
    });

    it("exports every pair and perturbed start, and restores them", () => {
      const csv = sweepToCsv(one);
      const rows = csv
        .trim()
        .split("\n")
        .filter((line) => !line.startsWith("#"));
      expect(rows[0]).toBe(SWEEP_CSV_COLUMNS.join(","));
      expect(csv).toContain(
        "# second_variable: pendulum-1.angle (deg), grid 3 x 2",
      );
      expect(csv).toMatch(
        /# perturbation: pendulum-1\.angle \(deg\) gaussian sigma 1\.5/,
      );
      const first = one.points[0];
      expect(rows).toContain(
        `0,1.5,m,10,deg,1,${first.perturbed!.inputs[1]},${first.perturbed!.values[1]},s,perturbed`,
      );
      expect(rows.filter((line) => line.endsWith(",synthetic"))).toHaveLength(
        12,
      );
      const back = parseSweepRecord(JSON.parse(JSON.stringify(one)));
      expect(back.spec).toEqual(one.spec);
      expect(back.points).toEqual(one.points);
      const methods = sweepMethods(one);
      expect(methods).toMatch(/on a 3 × 2 grid/);
      expect(methods).toMatch(
        /run 2 times from pendulum-1 release angle plus a Gaussian draw with σ = 1\.5 deg/,
      );
    });
  });
});

describe("grid and perturbation form", () => {
  it("turns the extra fields into a spec and reconciles them with the scene", () => {
    const form = defaultSweepForm(pendulum, 11);
    expect(form.variable2).not.toBe(form.variable);
    expect(form.perturbVariable).toBe("pendulum-1.angle");
    const outcome = formToSpec(
      {
        ...form,
        grid: true,
        variable2: "pendulum-1.angle",
        from2: "10",
        to2: "30",
        step2: "10",
        perturb: true,
        perturbSigma: "1",
        repeats: "2",
      },
      pendulum,
      defaultProtocol(pendulum),
    );
    expect(outcome.error).toBeUndefined();
    expect(outcome.spec?.second).toEqual({
      variable: "pendulum-1.angle",
      values: [10, 20, 30],
    });
    expect(outcome.spec?.perturbation).toEqual({
      variable: "pendulum-1.angle",
      sigma: 1,
    });
    expect(outcome.spec?.repeats).toBe(2);
    expect(
      formToSpec(
        { ...form, grid: true, variable2: form.variable },
        pendulum,
        defaultProtocol(pendulum),
      ).error,
    ).toMatch(/must differ/);
    // An incline has no initial condition to perturb, so the toggle falls back off.
    const incline = makeScene("incline");
    const moved = reconcileForm(incline, { ...form, perturb: true });
    expect(moved.perturb).toBe(false);
    expect(moved.variable2).not.toBe(moved.variable);
  });
});
