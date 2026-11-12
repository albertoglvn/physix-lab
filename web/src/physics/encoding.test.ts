import { describe, expect, it } from "vitest";
import encodingFixture from "../../../tests/fixtures/encoding_v1.json";
import postFixture from "../../../tests/fixtures/postprocess_v1.json";
import type { Case } from "./case";
import { examplePlate, traction } from "./case";
import { checkDomain, decide, type Domain } from "./domain";
import { COLS, encodeFeatures, FEATURE_CHANNELS, fitsFrame, PIXELS, ROWS, solidMask } from "./encoding";
import { combineTargets, ensembleStatistics, vonMises } from "./stats";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

describe("feature encoding matches the Python fixture", () => {
  it("declares the same raster contract", () => {
    expect(encodingFixture.schema).toBe("physix.raster/1");
    expect([encodingFixture.rows, encodingFixture.cols]).toEqual([ROWS, COLS]);
    expect(encodingFixture.channels).toEqual([...FEATURE_CHANNELS]);
  });

  for (const entry of encodingFixture.cases) {
    it(`encodes ${entry.name}`, () => {
      const feats = encodeFeatures(entry.case as Case);
      expect(feats.length).toBe(FEATURE_CHANNELS.length * PIXELS);
      const tol = encodingFixture.tolerance;
      entry.channel_sums.forEach((expected, c) => {
        let sum = 0;
        for (let k = 0; k < PIXELS; k++) sum += feats[c * PIXELS + k];
        if (Math.abs(expected) > 1) expect(rel(sum, expected)).toBeLessThan(tol.sum_rel);
        else expect(Math.abs(sum - expected)).toBeLessThan(tol.sum_rel * PIXELS);
      });
      encodingFixture.pixels.forEach(([i, j], p) => {
        entry.values[p].forEach((expected, c) => {
          expect(Math.abs(feats[c * PIXELS + i * COLS + j] - expected)).toBeLessThan(tol.value_abs);
        });
      });
    });
  }

  it("puts row 0 at the top of the part", () => {
    const feats = encodeFeatures(examplePlate());
    const y = (i: number) => feats[3 * PIXELS + i * COLS];
    expect(y(0)).toBeGreaterThan(y(ROWS - 1));
  });
});

/** Mirrors `data.fixtures.synthetic_members`. */
function syntheticMembers(k: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let m = 0; m < k; m++) {
    const t = new Float32Array(6 * PIXELS);
    for (let c = 0; c < 6; c++)
      for (let i = 0; i < ROWS; i++)
        for (let j = 0; j < COLS; j++)
          t[c * PIXELS + i * COLS + j] =
            Math.sin(0.11 * (c + 1) * i + 0.07 * j) + 0.5 * Math.cos(0.05 * j * (c + 1)) + 0.04 * m * Math.sin(0.3 * i + 0.2 * j);
    out.push(t);
  }
  return out;
}

describe("domain check and ensemble statistics match the Python fixture", () => {
  const domain = postFixture.domain as unknown as Domain;
  const members = syntheticMembers(postFixture.members);

  for (const entry of postFixture.cases) {
    it(`checks ${entry.name}`, () => {
      const c = entry.case as Case;
      expect(checkDomain(c, domain)).toEqual(entry.domain);
      if (!entry.statistics) {
        expect(fitsFrame(c)).toBe(false);
        return;
      }
      const mask = solidMask(c);
      expect(mask.reduce((a, b) => a + b, 0)).toBe(entry.statistics.mask_pixels);
      const masked = members.map((m) => m.map((v, idx) => v * mask[idx % PIXELS]));
      const res = ensembleStatistics(masked, mask, c);
      const tol = postFixture.tolerance.rel;
      expect(res.hotspot.row).toBe(entry.statistics.hotspot.row);
      expect(res.hotspot.col).toBe(entry.statistics.hotspot.col);
      expect(rel(res.hotspot.von_mises, entry.statistics.hotspot.von_mises)).toBeLessThan(tol);
      expect(rel(res.disagreement, entry.statistics.disagreement)).toBeLessThan(1e-3);
      expect(rel(res.fieldSpread, entry.statistics.field_spread)).toBeLessThan(1e-3);
      res.memberHotspots.forEach((v, k) => expect(rel(v, entry.statistics!.member_hotspots[k])).toBeLessThan(tol));
    });
  }
});

describe("post-processing", () => {
  it("uses the plane-stress von Mises formula", () => {
    expect(vonMises(100, 0, 0)).toBeCloseTo(100);
    expect(vonMises(0, 0, 10)).toBeCloseTo(10 * Math.sqrt(3));
    expect(vonMises(50, 50, 0)).toBeCloseTo(50);
  });

  it("combines unit fields linearly with the case traction", () => {
    const t = new Float32Array(6 * PIXELS).fill(1);
    t.fill(2, 3 * PIXELS);
    const [tx, ty] = traction(examplePlate());
    const s = combineTargets(t, tx, ty);
    expect(s[0]).toBeCloseTo(tx + 2 * ty, 0);
  });

  it("converts a force load to traction with the thickness", () => {
    const c = examplePlate();
    c.load = { kind: "force", x: 4000, y: 0 };
    expect(traction(c)[0]).toBeCloseTo(4000 / (0.08 * 0.005));
  });

  it("decides fallback in the documented order", () => {
    const policy = { threshold: 0.05 };
    expect(decide(policy, 0.01, false)).toEqual([false, "out_of_domain"]);
    expect(decide(policy, Number.NaN, true)).toEqual([false, "non_finite_prediction"]);
    expect(decide(policy, 0.06, true)).toEqual([false, "high_disagreement"]);
    expect(decide(policy, 0.05, true)).toEqual([true, null]);
    expect(decide({ threshold: -1 }, 0, true)[0]).toBe(false);
  });
});
