import { describe, expect, it } from "vitest";
import type { Case } from "../../physics/case";
import { examplePlate, exampleBracket } from "../../physics/case";
import {
  pixelCentre,
  PIXELS,
  ROWS,
  COLS,
  solidMask,
} from "../../physics/encoding";
import {
  defaultLines,
  gridSampler,
  isSectionCut,
  lineLength,
  linePoints,
  probeCsv,
  probeProfile,
  PROBE_CSV_COLUMNS,
  SECTION_SAMPLES,
  sectionNormal,
  sectionResultant,
  surrogateSampler,
} from "./probe";

function plainPlate(): Case {
  const c = examplePlate();
  c.geometry.holes = [];
  return c;
}

/** A raster field defined by f(x, y) at pixel centres. */
function rasterOf(c: Case, f: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(PIXELS);
  for (let i = 0; i < ROWS; i++)
    for (let j = 0; j < COLS; j++) {
      const [x, y] = pixelCentre(c, i, j);
      out[i * COLS + j] = f(x, y);
    }
  return out;
}

describe("line points", () => {
  it("includes both end points and spaces them evenly", () => {
    const pts = linePoints({ a: [0, 0], b: [0.1, 0.05] }, 11);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[10]).toEqual([0.1, 0.05]);
    expect(pts[1][0]).toBeCloseTo(0.01, 12);
    expect(lineLength({ a: [0, 0], b: [0.03, 0.04] })).toBeCloseTo(0.05, 12);
  });

  it("rejects degenerate lines", () => {
    expect(() => linePoints({ a: [0, 0], b: [1, 1] }, 1)).toThrow(/two points/);
    expect(() => linePoints({ a: [0.2, 0.1], b: [0.2, 0.1] }, 5)).toThrow(
      /distinct/,
    );
  });
});

describe("surrogate grid sampler", () => {
  const c = examplePlate();
  const f = (x: number, y: number) => 3e6 + 1e8 * x - 5e7 * y;
  const sample = gridSampler(c, [rasterOf(c, f)]);

  it("reproduces a linear field away from holes", () => {
    for (const [x, y] of [
      [0.031, 0.021],
      [0.15, 0.062],
      [0.177, 0.011],
    ])
      expect(sample(x, y)![0]).toBeCloseTo(f(x, y), 0);
  });

  it("returns null inside a hole and outside the part", () => {
    expect(sample(0.1, 0.04)).toBeNull();
    expect(sample(0.21, 0.04)).toBeNull();
    expect(sample(0.05, -0.001)).toBeNull();
  });

  it("only blends solid pixels next to a hole", () => {
    // Inside the hole every pixel is zero; a solid point at the rim must not be pulled down.
    const mask = solidMask(c);
    const ones = new Float32Array(PIXELS).map((_, k) => (mask[k] ? 1 : 0));
    const rim = gridSampler(c, [ones], mask);
    expect(rim(0.1, 0.04 + 0.0121)![0]).toBeCloseTo(1, 12);
    expect(rim(0.1 - 0.0121, 0.04)![0]).toBeCloseTo(1, 12);
  });
});

describe("section resultant", () => {
  it("balances a uniform tension across any cut of a plain plate", () => {
    const c = plainPlate();
    const sx = rasterOf(c, () => 10e6);
    const zero = new Float32Array(PIXELS);
    const stress = new Float32Array(3 * PIXELS);
    stress.set(sx, 0);
    stress.set(zero, PIXELS);
    const sampler = surrogateSampler(c, stress);
    const line = { a: [0.07, 0.08], b: [0.07, 0] } as const;
    const profile = probeProfile(
      sampler,
      { a: [...line.a], b: [...line.b] },
      "surrogate",
      SECTION_SAMPLES,
    );
    const [fx, fy] = sectionResultant(c, profile);
    expect(fx).toBeCloseTo(10e6 * 0.08 * c.thickness, 6);
    expect(fy).toBeCloseTo(0, 6);
  });

  it("orients the normal towards the load edge", () => {
    const c = examplePlate();
    expect(sectionNormal(c, { a: [0.1, 0], b: [0.1, 0.08] })).toEqual([1, -0]);
    expect(sectionNormal(c, { a: [0.1, 0.08], b: [0.1, 0] })).toEqual([1, 0]);
  });
});

describe("section cuts", () => {
  it("recognises full cuts of the plate", () => {
    const c = examplePlate();
    expect(isSectionCut(c, { a: [0.1, 0], b: [0.1, 0.08] })).toBe(true);
    expect(isSectionCut(c, { a: [0.05, -0.01], b: [0.06, 0.09] })).toBe(true);
    expect(isSectionCut(c, { a: [0, 0.04], b: [0.2, 0.04] })).toBe(false);
    expect(isSectionCut(c, { a: [0.1, 0], b: [0.1, 0.02] })).toBe(false);
  });

  it("offers presets that are cuts where they claim to be sections", () => {
    for (const c of [examplePlate(), plainPlate(), exampleBracket()])
      for (const preset of defaultLines(c))
        expect(isSectionCut(c, preset.line)).toBe(preset.id !== "centreline");
  });
});

describe("probe CSV", () => {
  it("writes SI columns with empty cells outside the solid", () => {
    const c = examplePlate();
    const sampler = () => [1, 2, 3] as [number, number, number];
    const hole = (x: number, y: number) =>
      Math.hypot(x - 0.1, y - 0.04) < 0.012 ? null : sampler();
    const profile = probeProfile(
      hole,
      { a: [0.1, 0], b: [0.1, 0.08] },
      "surrogate",
      5,
    );
    const text = probeCsv([profile], [`case: ${c.family}`]);
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("# physix.probe/1");
    expect(lines[1]).toBe("# case: plate");
    const header = lines.findIndex((l) => !l.startsWith("#"));
    expect(lines[header]).toBe(PROBE_CSV_COLUMNS.join(","));
    expect(lines.slice(header + 1)).toHaveLength(5);
    expect(lines[header + 3]).toBe("surrogate,0.04,0.1,0.04,,,,");
    expect(lines[header + 1].split(",")[4]).toBe("1");
  });
});
