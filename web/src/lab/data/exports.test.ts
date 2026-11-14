import { beforeAll, describe, expect, it } from "vitest";
import { makeScene, type LabScene } from "../scene";
import {
  checkConvergence,
  type ConvergenceResult,
} from "../motion/convergence";
import { defaultProtocol, type Protocol } from "../motion/probes";
import { reproduce, runProtocol, type MotionRun } from "../motion/run";
import { compare, referencesFor } from "../motion/theory";
import {
  experimentJson,
  isExperiment,
  makeExperiment,
  parseExperiment,
} from "../state/experiment";
import { CSV_COLUMNS, parseRunCsv, runToCsv } from "./exportCsv";
import { formatDelta, formatStep, methodsSummary } from "./methods";

let scene: LabScene;
let protocol: Protocol;
let run: MotionRun;

beforeAll(async () => {
  scene = makeScene("friction");
  protocol = defaultProtocol(scene);
  run = await runProtocol(scene, protocol);
});

describe("tidy CSV export", () => {
  it("writes one row per sample and quantity and reads back the same values", () => {
    const text = runToCsv([run]);
    const { meta, rows } = parseRunCsv(text);
    expect(meta[0]).toBe(`physix.run/1 ${run.id}`);
    expect(meta.some((line) => line.startsWith("time_step_s: "))).toBe(true);
    expect(text).toContain(`\n${CSV_COLUMNS.join(",")}\n`);
    expect(rows).toHaveLength(run.quantities.length * run.series.t.length);
    for (const quantity of run.quantities) {
      const column = rows.filter((row) => row.quantity === quantity.key);
      expect(column.map((row) => row.t)).toEqual(run.series.t);
      expect(column.map((row) => row.value)).toEqual(
        run.series.columns[quantity.key],
      );
      expect(column.every((row) => row.unit === quantity.unit)).toBe(true);
      expect(column.every((row) => row.source === quantity.source)).toBe(true);
    }
  });

  it("quotes cells with commas or quotes and rejects foreign columns", () => {
    const odd: MotionRun = {
      ...run,
      quantities: [{ ...run.quantities[0], unit: 'm, "approx"' }],
    };
    const { rows } = parseRunCsv(runToCsv([odd]));
    expect(rows[0].unit).toBe('m, "approx"');
    expect(() => parseRunCsv("a,b\n1,2\n")).toThrow("columns");
  });

  it("keeps a missing sample as an empty cell", () => {
    const gap: MotionRun = {
      ...run,
      quantities: [run.quantities[0]],
      series: {
        t: [0, 1],
        columns: { [run.quantities[0].key]: [Number.NaN, 2] },
      },
    };
    const text = runToCsv([gap]);
    expect(text).toContain(`,0,${run.quantities[0].key},,`);
    expect(Number.isNaN(parseRunCsv(text).rows[0].value)).toBe(true);
  });
});

describe("experiment files", () => {
  it("round-trips through JSON and reproduces its run exactly", async () => {
    const experiment = await makeExperiment(scene, protocol, [run]);
    expect(experiment.id).toMatch(/^sha256:/);
    expect(experiment.probes.find(({ id }) => id === "block-1.speed")).toEqual({
      id: "block-1.speed",
      target: "block-1",
      quantity: "speed",
      rate: 60,
    });
    const text = experimentJson(experiment);
    const parsed = parseExperiment(JSON.parse(text));
    expect(isExperiment(JSON.parse(text))).toBe(true);
    expect(parsed.studies.motion.scene).toEqual(scene);
    expect(parsed.protocol).toEqual(protocol);
    expect(parsed.runs[0].series).toEqual(run.series);
    const check = await reproduce(parsed.runs[0]);
    expect(check.identical).toBe(true);
    expect(check.sameIdentity).toBe(true);
  });

  it("names the experiment by its inputs, not its runs", async () => {
    const empty = await makeExperiment(scene, protocol, []);
    const full = await makeExperiment(scene, protocol, [run]);
    expect(empty.id).toBe(full.id);
    const changed = await makeExperiment(
      { ...scene, floorFriction: 0.5 },
      protocol,
      [],
    );
    expect(changed.id).not.toBe(full.id);
  });

  it("rejects files that are not experiments or carry broken runs", async () => {
    expect(isExperiment({ schema: "physix.lab/1" })).toBe(false);
    expect(() => parseExperiment(makeScene("incline"))).toThrow(
      "physix.experiment/1",
    );
    const experiment = JSON.parse(
      experimentJson(await makeExperiment(scene, protocol, [run])),
    );
    experiment.runs[0].series.columns["block-1.x"].pop();
    expect(() => parseExperiment(experiment)).toThrow("wrong length");
    experiment.runs[0].schema = "physix.run/0";
    expect(() => parseExperiment(experiment)).toThrow("physix.run/1");
    expect(() =>
      parseExperiment({ ...experiment, protocol: { stop: "time" } }),
    ).toThrow("time limit");
  });
});

describe("methods summary", () => {
  let convergence: ConvergenceResult;
  beforeAll(async () => {
    const [reference] = referencesFor(scene);
    convergence = await checkConvergence(scene, protocol, reference);
  });

  it("states the engine, step, probes, stop, references and run identity", () => {
    const comparisons = referencesFor(scene).map((reference) =>
      compare(reference, run),
    );
    const text = methodsSummary(run, comparisons, convergence);
    expect(text).toContain(`rapier3d-compat ${run.engine.version}`);
    expect(text).toContain("fixed step of 1/120 s");
    expect(text).toContain("8 solver iterations");
    expect(text).toContain("sampled at 60 Hz");
    expect(text).toContain("stopped when block-1 came to rest");
    expect(text).toContain("d = v₀² / (2 μ g)");
    expect(text).toContain("1/120 s, 1/240 s, 1/480 s");
    expect(text).toContain(run.id);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("names the friction of every surface", async () => {
    const incline = makeScene("incline");
    const short = await runProtocol(incline, { stop: "time", maxTime: 0.5 });
    const text = methodsSummary(short, []);
    expect(text).toContain("floor μ = 0.35");
    expect(text).toContain("ramp-1 μ = 0.2 at 26°");
    expect(text).toContain("at the time limit");
  });

  it("states the air and the applied forces", async () => {
    const push = makeScene("push");
    const pushed = await runProtocol(push, { stop: "time", maxTime: 0.5 });
    expect(methodsSummary(pushed, [])).toContain(
      "block-1 (10 N, 0 N) from 0 s to 1 s",
    );
    const drag = makeScene("drag");
    const fall = await runProtocol(
      { ...drag, linearDrag: 0.2 },
      { stop: "time", maxTime: 0.5 },
    );
    const text = methodsSummary(fall, []);
    expect(text).toContain("ρ = 1.2 kg/m³ (ball-1 C_d = 0.47)");
    expect(text).toContain("linear drag b v with b = 0.2 N·s/m");
    expect(text).not.toMatch(/undefined|NaN|false/);
  });

  it("states each pendulum's link and how forces are measured", async () => {
    const compound = makeScene("compound");
    const swing = await runProtocol(compound, { stop: "time", maxTime: 0.5 });
    const text = methodsSummary(swing, []);
    expect(text).toContain(
      "pendulum-1 hangs on a rigid rod of 3 m and 2 kg (I = M L²/3 about the pivot)",
    );
    expect(text).toContain("contact forces and link tension are measured");
    const rope = makeScene("rope");
    const fall = await runProtocol(rope, { stop: "time", maxTime: 0.5 });
    expect(methodsSummary(fall, [])).toContain(
      "pendulum-1 hangs on a massless rope of 3 m",
    );
  });

  it("formats steps and differences", () => {
    expect(formatStep(1 / 120)).toBe("1/120 s");
    expect(formatStep(0.003)).toBe("0.003 s");
    const [reference] = referencesFor(scene);
    expect(formatDelta({ reference, relative: true })).toBe("pending");
    expect(
      formatDelta({ reference, relative: true, delta: 0.0008, measured: 1 }),
    ).toBe("+0.08 %");
    expect(
      formatDelta({ reference, relative: false, delta: -0.002, measured: 1 }),
    ).toBe("−0.002 m");
  });
});
