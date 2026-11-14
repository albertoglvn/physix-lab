import { describe, expect, it } from "vitest";
import { ellipticK, finiteMean, meanPeriod, upwardCrossings } from "./period";

const sample = (f: (t: number) => number, seconds: number, rate = 60) => {
  const t = Array.from({ length: seconds * rate + 1 }, (_, i) => i / rate);
  return { t, v: t.map(f) };
};

describe("oscillation period", () => {
  it("recovers the period of a sampled sine and of a damped oscillation", () => {
    const sine = sample((t) => Math.sin(2 * Math.PI * (t / 1.3) + 0.4), 10);
    expect(meanPeriod(sine.t, sine.v, 0)).toBeCloseTo(1.3, 4);
    const damped = sample(
      (t) => Math.exp(-0.3 * t) * Math.cos(2 * Math.PI * (t / 0.8)),
      8,
    );
    expect(meanPeriod(damped.t, damped.v, 0)).toBeCloseTo(0.8, 3);
  });

  it("needs two crossings and skips missing samples", () => {
    expect(meanPeriod([0, 1], [-1, 1], 0)).toBeUndefined();
    expect(upwardCrossings([0, 1, 2, 3], [-1, Number.NaN, 1, -1], 0)).toEqual(
      [],
    );
    expect(upwardCrossings([0, 1], [-1, 3], 0)).toEqual([0.25]);
    expect(finiteMean([1, Number.NaN, 3])).toBe(2);
    expect(finiteMean([])).toBeNaN();
  });
});

describe("complete elliptic integral", () => {
  it("matches tabulated values", () => {
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 14);
    expect(ellipticK(Math.sin(Math.PI / 6))).toBeCloseTo(1.685750354812596, 12);
    expect(ellipticK(Math.SQRT1_2)).toBeCloseTo(1.854074677301372, 12);
    expect(ellipticK(1)).toBe(Number.POSITIVE_INFINITY);
  });
});
