import { describe, expect, it } from "vitest";
import { noiseProblem, noisyReading, readingUncertainty } from "./noise";
import { gaussian, hashSeed, mulberry32, stream } from "./random";

describe("seeded random streams", () => {
  it("repeats a stream from its seed and keys", () => {
    const a = stream(42, 3, 1);
    const b = stream(42, 3, 1);
    const values = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(values);
    values.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  it("separates streams by seed and by each key", () => {
    const first = (seed: number, ...keys: number[]) => stream(seed, ...keys)();
    const base = first(42, 3, 1);
    expect(first(43, 3, 1)).not.toBe(base);
    expect(first(42, 4, 1)).not.toBe(base);
    expect(first(42, 3, 2)).not.toBe(base);
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
  });

  it("rejects keys that are not integers", () => {
    expect(() => hashSeed(1.5)).toThrow(/integers/);
  });

  it("draws standard normal numbers", () => {
    const random = mulberry32(7);
    const draws = Array.from({ length: 20000 }, () => gaussian(random));
    const mean = draws.reduce((sum, v) => sum + v, 0) / draws.length;
    const variance =
      draws.reduce((sum, v) => sum + (v - mean) ** 2, 0) / draws.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeCloseTo(1, 1);
    expect(draws.every(Number.isFinite)).toBe(true);
  });
});

describe("virtual-sensor noise", () => {
  it("adds seeded Gaussian error and rounds to the resolution", () => {
    const noise = { sigma: 0.05, resolution: 0.01 };
    const reading = noisyReading(1.234, noise, stream(1, 0, 0));
    expect(reading).toBe(noisyReading(1.234, noise, stream(1, 0, 0)));
    expect(reading).not.toBe(1.234);
    expect(Math.abs(reading / 0.01 - Math.round(reading / 0.01))).toBeLessThan(
      1e-9,
    );
  });

  it("only rounds when σ is zero", () => {
    expect(
      noisyReading(1.234, { sigma: 0, resolution: 0.1 }, mulberry32(1)),
    ).toBeCloseTo(1.2, 12);
  });

  it("combines σ and the rounding error in quadrature", () => {
    expect(readingUncertainty({ sigma: 0.03, resolution: 0 })).toBe(0.03);
    expect(readingUncertainty({ sigma: 0, resolution: Math.sqrt(12) })).toBe(1);
  });

  it("explains unusable settings", () => {
    expect(noiseProblem({ sigma: 0.1, resolution: 0 })).toBeNull();
    expect(noiseProblem({ sigma: -1, resolution: 0 })).toMatch(/σ/);
    expect(noiseProblem({ sigma: 0, resolution: Number.NaN })).toMatch(
      /Resolution/,
    );
    expect(noiseProblem({ sigma: 0, resolution: 0 })).toMatch(/turn noise off/);
  });
});
