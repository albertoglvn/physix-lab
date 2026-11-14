import { describe, expect, it } from "vitest";
import {
  bandAt,
  BAND_COVERAGE,
  fitExpression,
  FitError,
  invert,
  leastSquares,
  polynomialGuess,
  presetById,
} from "./fit";
import { gaussian, mulberry32 } from "./random";

const range = (from: number, to: number, step: number) =>
  Array.from(
    { length: Math.round((to - from) / step) + 1 },
    (_, i) => from + i * step,
  );

describe("least-squares fitting", () => {
  it("recovers an exact line", () => {
    const xs = range(0, 5, 1);
    const ys = xs.map((x) => 2 + 3 * x);
    const { result } = fitExpression("a + b*x", xs, ys, {
      preset: presetById("linear"),
    });
    expect(result.parameters[0].value).toBeCloseTo(2, 9);
    expect(result.parameters[1].value).toBeCloseTo(3, 9);
    expect(result.r2).toBeCloseTo(1, 12);
    expect(result.converged).toBe(true);
    expect(result.chi2).toBeUndefined();
  });

  it("matches the textbook standard errors of a straight line", () => {
    const random = mulberry32(5);
    const xs = range(0, 9, 1);
    const ys = xs.map((x) => 1 + 0.5 * x + 0.2 * gaussian(random));
    const { result } = fitExpression("a + b*x", xs, ys);
    const n = xs.length;
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const sxx = xs.reduce((s, x) => s + (x - mean) ** 2, 0);
    const s2 = result.ssr / (n - 2);
    expect(result.dof).toBe(n - 2);
    expect(result.parameters[1].se).toBeCloseTo(Math.sqrt(s2 / sxx), 6);
    expect(result.parameters[0].se).toBeCloseTo(
      Math.sqrt(s2 * (1 / n + mean ** 2 / sxx)),
      6,
    );
    // With absolute σ the slope's error is σ/√Sxx, whatever the scatter.
    const weighted = fitExpression("a + b*x", xs, ys, { sigma: 0.2 }).result;
    expect(weighted.parameters[1].se).toBeCloseTo(0.2 / Math.sqrt(sxx), 6);
    expect(weighted.chi2).toBeCloseTo(result.ssr / 0.04, 6);
    expect(weighted.reducedChi2).toBeCloseTo(weighted.chi2! / (n - 2), 12);
  });

  it("covers the true slope about 95 % of the time at ±2 SE", () => {
    const xs = range(0, 9, 1);
    let inside = 0;
    const trials = 300;
    for (let trial = 0; trial < trials; trial++) {
      const random = mulberry32(1000 + trial);
      const ys = xs.map((x) => 4 - 1.5 * x + 0.3 * gaussian(random));
      const slope = fitExpression("a + b*x", xs, ys, { sigma: 0.3 }).result
        .parameters[1];
      if (Math.abs(slope.value + 1.5) <= BAND_COVERAGE * slope.se) inside++;
    }
    expect(inside / trials).toBeGreaterThan(0.91);
    expect(inside / trials).toBeLessThan(0.99);
  });

  it("fits the nonlinear presets from their data-driven guesses", () => {
    const xs = range(0.5, 5, 0.5);
    const power = fitExpression(
      "a*x^b",
      xs,
      xs.map((x) => 3 * x ** 1.7),
      { preset: presetById("power") },
    ).result;
    expect(power.parameters.map((p) => p.value)).toEqual([
      expect.closeTo(3, 8),
      expect.closeTo(1.7, 8),
    ]);
    const exponential = fitExpression(
      "a*exp(b*x)",
      xs,
      xs.map((x) => 2 * Math.exp(-0.4 * x)),
      { preset: presetById("exponential") },
    ).result;
    expect(exponential.parameters[1].value).toBeCloseTo(-0.4, 8);
    const cubic = polynomialGuess(
      xs,
      xs.map((x) => 1 - x + 0.5 * x ** 3),
      3,
    );
    expect(cubic).toEqual([
      expect.closeTo(1, 8),
      expect.closeTo(-1, 8),
      expect.closeTo(0, 8),
      expect.closeTo(0.5, 8),
    ]);
  });

  it("recovers μ from incline accelerations", () => {
    const g = 9.81;
    const xs = range(20, 50, 2);
    const ys = xs.map((deg) => {
      const theta = (deg * Math.PI) / 180;
      return g * (Math.sin(theta) - 0.2 * Math.cos(theta));
    });
    const preset = presetById("incline")!;
    const { result, compiled } = fitExpression(preset.expression, xs, ys, {
      constants: { g },
      preset,
    });
    expect(compiled.parameters).toEqual(["mu"]);
    expect(result.parameters[0].value).toBeCloseTo(0.2, 9);
  });

  it("keeps residuals aligned with the input and skips non-finite points", () => {
    const xs = [0, 1, 2, Number.NaN, 4];
    const ys = [1, 3, 5, 7, 9];
    const result = leastSquares(
      (x, p) => p[0] + p[1] * x,
      ["a", "b"],
      xs,
      ys,
      [0, 0],
    );
    expect(result.n).toBe(4);
    expect(result.residuals).toHaveLength(5);
    expect(result.residuals[3]).toBeNaN();
    expect(Math.abs(result.residuals[4])).toBeLessThan(1e-9);
  });

  it("draws the band from the covariance", () => {
    const random = mulberry32(9);
    const xs = range(0, 9, 1);
    const ys = xs.map((x) => 1 + 2 * x + gaussian(random));
    const f = (x: number, p: readonly number[]) => p[0] + p[1] * x;
    const result = leastSquares(f, ["a", "b"], xs, ys, [0, 0]);
    const [[va, cab], [, vb]] = result.covariance;
    const band = bandAt(f, result, 3);
    expect(band.se).toBeCloseTo(Math.sqrt(va + 2 * 3 * cab + 9 * vb), 6);
  });

  it("refuses fits it cannot determine", () => {
    expect(() => fitExpression("a + b*x", [1, 2], [1, 2])).toThrow(
      /at least 3 points/,
    );
    expect(() => fitExpression("a*b*x", [1, 2, 3, 4], [2, 4, 6, 8])).toThrow(
      FitError,
    );
    expect(() => fitExpression("2*x", [1, 2, 3], [2, 4, 6])).toThrow(
      /no parameters/,
    );
    expect(() =>
      fitExpression("log(a*x)", [1, 2, 3], [0, 1, 2], { start: { a: -1 } }),
    ).toThrow(/starting values/);
  });

  it("inverts small matrices", () => {
    expect(
      invert([
        [4, 7],
        [2, 6],
      ]),
    ).toEqual([
      [expect.closeTo(0.6, 12), expect.closeTo(-0.7, 12)],
      [expect.closeTo(-0.2, 12), expect.closeTo(0.4, 12)],
    ]);
    expect(
      invert([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });
});
