import { describe, expect, it } from "vitest";
import type { PredictionResponse } from "../../api/client";
import type { SurrogatePrediction } from "../../inference/engine";
import { examplePlate, type Case } from "../../physics/case";
import {
  checkStressSpec,
  confirmStressPoint,
  femResult,
  MAX_STRESS_POINTS,
  runStressPoint,
  runStressSweep,
  STRESS_SWEEP_CSV_COLUMNS,
  stressSweepCsv,
  stressSweepVariables,
  summarizeStressSweep,
  sweepValues,
  withValue,
  type StressSweepDeps,
  type StressSweepSpec,
} from "./stressSweep";
import { stressFormToSpec, sweepMarks } from "./StressSweepSheet";

const RADIUS = "geometry.holes[0].radius";

function prediction(
  hotspot: number,
  accepted: boolean,
  reason: SurrogatePrediction["reason"] = null,
): SurrogatePrediction {
  return {
    result: {
      hotspot: { von_mises: hotspot, x: 0.1, y: 0.052, row: 10, col: 64 },
      disagreement: 0.04,
    },
    accepted,
    reason,
    timing: { encode_ms: 1, inference_ms: 5, postprocess_ms: 1, total_ms: 7 },
  } as unknown as SurrogatePrediction;
}

function solved(hotspot: number, raster = true): PredictionResponse {
  return {
    summary: {
      hotspot: { von_mises: hotspot * 1.02, x: 0.1, y: 0.0521 },
      ...(raster
        ? {
            raster_hotspot: {
              von_mises: hotspot,
              x: 0.1,
              y: 0.052,
              row: 10,
              col: 64,
            },
          }
        : {}),
    },
    solver: { mesh_preset: "reference", nodes: 3900 },
    timing: { total_ms: 850 },
  } as unknown as PredictionResponse;
}

const spec = (values: number[]): StressSweepSpec => ({
  variable: RADIUS,
  values,
});

describe("stress sweep values and specs", () => {
  it("sets one geometry variable without touching the rest", () => {
    const c = examplePlate();
    const next = withValue(c, RADIUS, 0.015);
    expect(next.geometry.holes[0].radius).toBe(0.015);
    expect(c.geometry.holes[0].radius).toBe(0.012);
    expect(withValue(c, "geometry.holes[0].x", 0.09).geometry.holes[0].x).toBe(
      0.09,
    );
    expect(() => withValue(c, "geometry.width", 0.3)).toThrow(/Unknown/);
    expect(() => withValue(c, "geometry.holes[3].x", 0.1)).toThrow(/no hole 4/);
  });

  it("offers the optimizer's bounded variables", () => {
    const paths = stressSweepVariables(examplePlate()).map((v) => v.path);
    expect(paths).toEqual([
      RADIUS,
      "geometry.holes[0].x",
      "geometry.holes[0].y",
    ]);
  });

  it("spaces values evenly and keeps both ends", () => {
    expect(sweepValues(0.01, 0.02, 3)).toEqual([0.01, 0.015, 0.02]);
    expect(sweepValues(0.01, 0.02, 1)).toEqual([0.01]);
    expect(sweepValues(0.02, 0.01, 5).at(-1)).toBe(0.01);
  });

  it("rejects specs it cannot run", () => {
    const c = examplePlate();
    expect(checkStressSpec(c, spec([0.01]))).toBeNull();
    expect(
      checkStressSpec(c, { variable: "geometry.web_width", values: [1] }),
    ).toMatch(/variable/);
    expect(checkStressSpec(c, spec([]))).toMatch(/at least one/);
    expect(
      checkStressSpec(c, spec(sweepValues(0.01, 0.02, MAX_STRESS_POINTS + 1))),
    ).toMatch(/at most 41/);
    expect(checkStressSpec(c, spec([Number.NaN]))).toMatch(/finite/);
    expect(checkStressSpec(c, spec([-0.01]))).toMatch(/finite/);
  });

  it("reads the form in millimetres", () => {
    const c = examplePlate();
    const form = { variable: RADIUS, from: "8", to: "16", count: "5" };
    expect(stressFormToSpec(c, form).spec?.values).toEqual([
      0.008, 0.01, 0.012, 0.014, 0.016,
    ]);
    expect(stressFormToSpec(c, { ...form, from: "" }).error).toMatch(
      /mm|milli/,
    );
    expect(stressFormToSpec(c, { ...form, count: "0" }).error).toMatch(
      /1 to 41/,
    );
  });
});

describe("stress sweep points and sources", () => {
  const base = examplePlate();
  const values = [0.01, 0.012, 0.014];

  it("keeps an accepted surrogate screen", async () => {
    let solves = 0;
    const deps: StressSweepDeps = {
      predict: async () => prediction(120e6, true),
      solve: async () => {
        solves++;
        return solved(118e6);
      },
    };
    const point = await runStressPoint(base, spec(values), 1, deps);
    expect(point.source).toBe("surrogate");
    expect(point.value).toBe(120e6);
    expect(point.x).toBe(0.012);
    expect(point.surrogate?.disagreement).toBe(0.04);
    expect(solves).toBe(0);
  });

  it("solves a rejected screen with FEM and keeps the screen", async () => {
    const deps: StressSweepDeps = {
      predict: async () => prediction(120e6, false, "high_disagreement"),
      solve: async () => solved(110e6),
    };
    const point = await runStressPoint(base, spec(values), 0, deps);
    expect(point.source).toBe("fem_fallback");
    expect(point.reason).toBe("high_disagreement");
    expect(point.value).toBe(110e6);
    expect(point.fem?.basis).toBe("raster");
    expect(point.surrogate?.hotspot).toBe(120e6);
    expect(point.note).toMatch(/disagree/);
  });

  it("falls back when the model is missing and reports an offline solver", async () => {
    const solvedPoint = await runStressPoint(base, spec(values), 0, {
      predict: null,
      solve: async () => solved(110e6),
    });
    expect(solvedPoint.source).toBe("fem_fallback");
    expect(solvedPoint.reason).toBe("model_unavailable");
    const offline = await runStressPoint(base, spec(values), 0, {
      predict: async () => prediction(1, false, "out_of_domain"),
      solve: null,
    });
    expect(offline.source).toBeNull();
    expect(Number.isNaN(offline.value)).toBe(true);
    expect(offline.note).toMatch(/offline/);
  });

  it("sends a part taller than the model frame to FEM", async () => {
    const tall: Case = {
      ...base,
      geometry: { ...base.geometry, height: 0.2 },
    };
    let predicted = false;
    const point = await runStressPoint(tall, spec([0.012]), 0, {
      predict: async () => {
        predicted = true;
        return prediction(1, true);
      },
      solve: async () => solved(90e6, false),
    });
    expect(predicted).toBe(false);
    expect(point.reason).toBe("outside_frame");
    expect(point.fem?.basis).toBe("mesh");
    expect(point.value).toBeCloseTo(90e6 * 1.02);
  });

  it("reports invalid geometry and solver failures without a value", async () => {
    const tooBig = await runStressPoint(base, spec([0.05]), 0, {
      predict: async () => prediction(1, true),
      solve: null,
    });
    expect(tooBig.source).toBeNull();
    expect(tooBig.note).toBeTruthy();
    const failed = await runStressPoint(base, spec(values), 0, {
      predict: async () => prediction(1, false, "out_of_domain"),
      solve: async () => {
        throw new Error("mesh failed");
      },
    });
    expect(failed.source).toBeNull();
    expect(failed.note).toMatch(/mesh failed/);
  });

  it("confirms a screened point with FEM", async () => {
    const deps: StressSweepDeps = {
      predict: async () => prediction(120e6, true),
      solve: async () => solved(100e6),
    };
    const point = await runStressPoint(base, spec(values), 2, deps);
    const confirmed = await confirmStressPoint(
      base,
      spec(values),
      point,
      deps.solve!,
    );
    expect(confirmed.source).toBe("fem");
    expect(confirmed.value).toBe(100e6);
    expect(confirmed.surrogate?.hotspot).toBe(120e6);
    expect(
      await confirmStressPoint(base, spec(values), confirmed, deps.solve!),
    ).toBe(confirmed);
  });

  it("runs in order and stops when aborted", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const points = await runStressSweep(
      base,
      spec(values),
      { predict: async () => prediction(120e6, true), solve: null },
      (p) => {
        seen.push(p.index);
        if (p.index === 1) controller.abort();
      },
      controller.signal,
    );
    expect(seen).toEqual([0, 1]);
    expect(points).toHaveLength(2);
  });
});

describe("stress sweep summary, plot and CSV", () => {
  const base = examplePlate();
  const values = [0.01, 0.012, 0.014, 0.05];

  async function points() {
    const verdicts = [true, false, true];
    let k = 0;
    const deps: StressSweepDeps = {
      predict: async () =>
        prediction(120e6, verdicts[k++] ?? true, "high_disagreement"),
      solve: async () => solved(100e6),
    };
    const out = await runStressSweep(base, spec(values), deps, () => {});
    out[2] = await confirmStressPoint(base, spec(values), out[2], deps.solve!);
    return out;
  }

  it("counts sources and the largest surrogate error on the raster basis", async () => {
    const summary = summarizeStressSweep(await points());
    expect(summary.counts).toEqual({ surrogate: 1, fem: 1, fem_fallback: 1 });
    expect(summary.missing).toBe(1);
    expect(summary.compared).toBe(2);
    expect(summary.maxSurrogateError).toBeCloseTo(0.2);
  });

  it("draws surrogate screens hollow with whiskers and solves filled", async () => {
    const marks = sweepMarks(await points());
    const hollow = marks.filter((m) => m.hollow);
    expect(hollow).toHaveLength(3);
    expect(hollow[0].low).toBeCloseTo(120 * 0.96);
    expect(hollow[0].high).toBeCloseTo(120 * 1.04);
    expect(marks.filter((m) => !m.hollow).map((m) => m.y)).toEqual([100, 100]);
  });

  it("exports one SI row per point with provenance", async () => {
    const csv = stressSweepCsv(base, spec(values), await points(), {
      modelId: "physix-unet-v1",
      threshold: 0.08,
    });
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("# physix.stress-sweep/1");
    expect(csv).toContain(
      "# model: physix-unet-v1, disagreement threshold 0.08",
    );
    const header = lines.findIndex(
      (l) => l === STRESS_SWEEP_CSV_COLUMNS.join(","),
    );
    const rows = lines.slice(header + 1).map((l) => l.split(","));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[3])).toEqual([
      "surrogate",
      "fem_fallback",
      "fem",
      "",
    ]);
    expect(rows[1][4]).toBe("100000000");
    expect(rows[1][7]).toBe("raster");
    expect(rows[1][12]).toBe("Pa");
    expect(rows[1][11]).toBe("reference");
  });

  it("prefers the raster hotspot so FEM compares with the surrogate grid", () => {
    expect(femResult(solved(100e6)).hotspot).toBe(100e6);
    expect(femResult(solved(100e6, false)).basis).toBe("mesh");
  });
});
