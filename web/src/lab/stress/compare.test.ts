import { describe, expect, it } from "vitest";
import {
  compareFields,
  profileDifference,
  relativeError,
  safetyFactor,
} from "./compare";
import type { ProbeProfile } from "./probe";

describe("field comparison", () => {
  it("measures masked RMSE and normalises the map by the FEM peak", () => {
    const fem = Float32Array.from([10, 20, 40, 1000]);
    const sur = Float32Array.from([12, 18, 40, 0]);
    const mask = Uint8Array.from([1, 1, 1, 0]);
    const out = compareFields(sur, fem, mask);
    expect(out.count).toBe(3);
    expect(out.femPeak).toBe(40);
    expect(out.rmse).toBeCloseTo(Math.sqrt(8 / 3), 6);
    expect(out.rmseRel).toBeCloseTo(Math.sqrt(8 / 3) / 40, 6);
    expect(out.maxAbs).toBe(2);
    [0.05, -0.05, 0, 0].forEach((expected, k) =>
      expect(out.diff[k]).toBeCloseTo(expected, 6),
    );
  });

  it("skips pixels where either field is undefined", () => {
    const out = compareFields(
      Float32Array.from([1, Number.NaN, 5]),
      Float32Array.from([1, 2, Number.NaN]),
      Uint8Array.from([1, 1, 1]),
    );
    expect(out.count).toBe(1);
    expect(out.rmse).toBe(0);
  });

  it("rejects mismatched rasters", () => {
    expect(() =>
      compareFields(
        new Float32Array(2),
        new Float32Array(3),
        new Uint8Array(3),
      ),
    ).toThrow();
  });
});

describe("scalar checks", () => {
  it("computes signed relative errors", () => {
    expect(relativeError(3.39, 3.347)).toBeCloseTo(0.0128, 4);
    expect(relativeError(1, 0)).toBeNull();
    expect(relativeError(null, 1)).toBeNull();
  });

  it("computes the safety factor only from positive inputs", () => {
    expect(safetyFactor(250e6, 50e6)).toBe(5);
    expect(safetyFactor(null, 50e6)).toBeNull();
    expect(safetyFactor(250e6, 0)).toBeNull();
  });
});

describe("profile difference", () => {
  const profile = (values: number[]): ProbeProfile => ({
    source: "fem",
    line: { a: [0, 0], b: [1, 0] },
    s: values.map((_, k) => k),
    x: values.map((_, k) => k),
    y: values.map(() => 0),
    sxx: values,
    syy: values,
    txy: values,
    vonMises: values,
  });

  it("compares points that lie in the solid on both profiles", () => {
    const out = profileDifference(
      profile([1, 2, NaN, 4]),
      profile([1, 1, 3, NaN]),
      "vonMises",
    );
    expect(out).toEqual({ rmse: Math.sqrt(0.5), maxAbs: 1, count: 2 });
  });
});
