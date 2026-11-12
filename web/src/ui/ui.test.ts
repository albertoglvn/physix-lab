import { describe, expect, it } from "vitest";
import { colorAt, fieldRange, lut, paint } from "./colormap";
import { mm, mpa, ms, newtons, parseNumber, pct, ratio } from "./units";

describe("colour maps", () => {
  it("build 256-entry tables that start and end at the declared stops", () => {
    const t = lut("stress");
    expect(t.length).toBe(768);
    expect([t[0], t[1], t[2]]).toEqual([13, 22, 66]);
    expect([t[765], t[766], t[767]]).toEqual([205, 38, 44]);
  });

  it("clamp and sanitise inputs", () => {
    expect(colorAt("stress", -3)).toBe(colorAt("stress", 0));
    expect(colorAt("stress", 7)).toBe(colorAt("stress", 1));
    expect(colorAt("stress", Number.NaN)).toBe(colorAt("stress", 0));
  });

  it("paints the same value with the same colour in every view", () => {
    const a = paint(
      [5],
      null,
      { min: 0, max: 10 },
      "stress",
      new Uint8ClampedArray(4),
    );
    const b = paint(
      [5],
      null,
      { min: 0, max: 10 },
      "stress",
      new Uint8ClampedArray(4),
    );
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[3]).toBe(255);
  });

  it("leaves masked and non-finite pixels transparent", () => {
    const out = paint(
      [1, 2, Number.NaN],
      [1, 0, 1],
      { min: 0, max: 2 },
      "stress",
      new Uint8ClampedArray(12),
    );
    expect(out[3]).toBe(255);
    expect(out[7]).toBe(0);
    expect(out[11]).toBe(0);
  });

  it("computes ranges over the solid mask only", () => {
    expect(fieldRange([1, 100, 3], [1, 0, 1])).toEqual({ min: 1, max: 3 });
    expect(fieldRange([Number.NaN])).toEqual({ min: 0, max: 1 });
    expect(fieldRange([2, 2])).toEqual({ min: 2, max: 3 });
  });
});

describe("unit formatting", () => {
  it("converts SI to display units at the edge", () => {
    expect(mpa(33.9e6)).toBe("33.9 MPa");
    expect(mpa(250e6)).toBe("250 MPa");
    expect(mpa(1.234e6)).toBe("1.23 MPa");
    expect(mm(0.012)).toBe("12.0 mm");
    expect(newtons(4000)).toBe("4.00 kN");
    expect(newtons(-500)).toBe("-500 N");
    expect(ms(0.25)).toBe("250 µs");
    expect(ms(1530)).toBe("1.53 s");
    expect(pct(0.0123)).toBe("1.2%");
    expect(ratio(42.123, 1)).toBe("42.1×");
  });

  it("renders missing values as a dash", () => {
    expect(mpa(null)).toBe("—");
    expect(mm(Number.NaN)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });

  it("parses user input", () => {
    expect(parseNumber("12,5")).toBeCloseTo(12.5);
    expect(parseNumber("abc")).toBeNaN();
  });
});
