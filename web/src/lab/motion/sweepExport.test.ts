import { beforeAll, describe, expect, it } from "vitest";
import { makeScene } from "../scene";
import { TIME_STEP } from "../simulation";
import {
  experimentJson,
  makeExperiment,
  parseExperiment,
} from "../state/experiment";
import { defaultProtocol } from "./probes";
import { SWEEP_SCHEMA, sweepValues, type SweepSpec } from "./sweep";
import {
  parseStoredFit,
  parseSweepRecord,
  storedFit,
  SWEEP_CSV_COLUMNS,
  sweepMethods,
  sweepToCsv,
} from "./sweepExport";
import { fitSweep } from "./sweepFit";
import { localRunner, runSweep, type SweepRecord } from "./sweepPool";

const scene = makeScene("incline");
const protocol = defaultProtocol(scene);
const spec: SweepSpec = {
  variable: "ramp-1.angle",
  values: sweepValues(20, 50, 10),
  metric: { kind: "reference", id: "block-1.incline.a" },
  repeats: 2,
  seed: 3,
  noise: { sigma: 0.05, resolution: 0.001 },
  protocol,
  timeStep: TIME_STEP,
};

let record: SweepRecord;
beforeAll(async () => {
  record = await runSweep(scene, spec, { runners: [localRunner()] });
});

const rows = (csv: string) =>
  csv
    .trim()
    .split("\n")
    .filter((line) => !line.startsWith("#"));

describe("sweep CSV", () => {
  it("writes one tidy row per value, reading and closed-form value", () => {
    const csv = sweepToCsv(record);
    const [header, ...body] = rows(csv);
    expect(header).toBe(SWEEP_CSV_COLUMNS.join(","));
    expect(body).toHaveLength(4 + 8 + 4);
    expect(csv).toContain(`# ${SWEEP_SCHEMA} ${record.id}`);
    expect(csv).toMatch(/# engine: rapier3d-compat \d/);
    expect(csv).toContain(
      "# synthetic_noise: gaussian sigma 0.05, resolution 0.001, 2 readings per point, seed 3",
    );
    expect(csv).toContain("# perturbation: none");
    expect(body[0]).toMatch(/^0,20,deg,,,,,[-\d.e]+,m\/s²,simulated$/);
    expect(body[1]).toMatch(/^0,20,deg,,,0,,[-\d.e]+,m\/s²,synthetic$/);
    expect(body.filter((line) => line.endsWith(",theory"))).toHaveLength(4);
  });

  it("leaves a missing value empty and states the fit", () => {
    const fit = storedFit(fitSweep(scene, spec, record.points, "incline", ""));
    const missing: SweepRecord = {
      ...record,
      points: [{ ...record.points[0], value: Number.NaN, readings: [] }],
    };
    expect(rows(sweepToCsv(missing))[1]).toBe("0,20,deg,,,,,,m/s²,simulated");
    expect(sweepToCsv(record, fit)).toMatch(
      /# fit: .*mu = [\d.]+ ± .*weighted/,
    );
  });
});

describe("incline fit across the sliding angle", () => {
  it("leaves out resting values and recovers the configured μ", async () => {
    const wide = {
      ...spec,
      values: sweepValues(5, 50, 5),
      repeats: 3,
      seed: 11,
    };
    const swept = await runSweep(scene, wide, { runners: [localRunner()] });
    const fit = fitSweep(scene, wide, swept.points, "incline", "");
    const [mu] = fit.result.parameters;
    expect(fit.excluded?.values).toEqual([5, 10]);
    expect(fit.result.n).toBe(8 * 3);
    expect(Math.abs(mu.value - 0.2)).toBeLessThan(2 * mu.se);
    expect(
      fitSweep(scene, wide, swept.points, "linear", "").excluded,
    ).toBeNull();
    const text = sweepMethods(swept, storedFit(fit));
    expect(text).toContain(
      "The fit left out θ = 5, 10 deg (at rest; the incline law describes sliding only).",
    );
  });
});

describe("sweep methods", () => {
  it("states the range, engine, noise seed, fit and identity", () => {
    const fit = storedFit(fitSweep(scene, spec, record.points, "incline", ""));
    const text = sweepMethods(record, fit);
    expect(text).toContain("from 20 to 50 deg in steps of 10 deg (4 values)");
    expect(text).toContain(`rapier3d-compat ${record.engine.version}`);
    expect(text).toContain("2 readings per value from seed 3");
    expect(text).toMatch(/A weighted least-squares fit .* to 8 readings/);
    expect(text).toMatch(/μ = [\d.]+ ± [\d.]+ \(± 1 standard error\)/);
    expect(text).toContain("χ²/dof");
    expect(text).toContain("with g = 9.81 to 8 readings");
    expect(text).toContain(
      "Bands show ± 2 standard errors of the fitted curve.",
    );
    expect(text).not.toContain("left out");
    expect(text.endsWith(`Sweep ${record.id}.`)).toBe(true);
  });

  it("reports a cancelled sweep and values without a result", () => {
    const clean = { ...spec, noise: null, repeats: 1 };
    const text = sweepMethods({
      ...record,
      spec: clean,
      status: "cancelled",
      points: [{ ...record.points[0], value: Number.NaN, readings: [] }],
    });
    expect(text).toContain("cancelled after 1 of 4 values");
    expect(text).toContain("1 value gave no result (θ = 20)");
    expect(text).not.toContain("Synthetic");
  });
});

describe("sweep in the experiment file", () => {
  it("round-trips the sweep and its fit without changing the identity", async () => {
    const fit = storedFit(fitSweep(scene, spec, record.points, "incline", ""));
    const plain = await makeExperiment(scene, protocol, []);
    const withSweep = await makeExperiment(scene, protocol, [], {
      record: { ...record, points: [...record.points] },
      fit,
    });
    expect(withSweep.id).toBe(plain.id);
    withSweep.sweep!.record.points[1] = {
      ...record.points[1],
      value: Number.NaN,
    };
    const restored = parseExperiment(JSON.parse(experimentJson(withSweep)));
    const sweep = restored.sweep!;
    expect(sweep.record.id).toBe(record.id);
    expect(sweep.record.spec).toEqual(spec);
    expect(sweep.record.points[0]).toEqual(record.points[0]);
    expect(sweep.record.points[1].value).toBeNaN();
    expect(sweep.fit?.parameters).toEqual(fit.parameters);
    const refit = fitSweep(
      sweep.record.scene,
      sweep.record.spec,
      record.points,
      sweep.fit!.model,
      sweep.fit!.expression,
    );
    expect(refit.result.parameters[0].value).toBeCloseTo(
      fit.parameters[0].value,
      12,
    );
    expect(parseExperiment(JSON.parse(experimentJson(plain))).sweep).toBe(
      undefined,
    );
  });

  it("rejects a malformed sweep or fit", () => {
    const json = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    expect(() => parseSweepRecord({ ...json, schema: "x" })).toThrow(
      /physix\.sweep\/1/,
    );
    expect(() => parseSweepRecord({ ...json, points: [{ index: 9 }] })).toThrow(
      /no valid index/,
    );
    expect(() =>
      parseSweepRecord({ ...json, spec: { ...spec, variable: "nope" } }),
    ).toThrow();
    expect(() => parseStoredFit({ model: "spline" })).toThrow(/unknown model/);
    expect(() =>
      parseStoredFit({ model: "custom", expression: " ", parameters: [] }),
    ).toThrow(/no expression/);
  });
});
