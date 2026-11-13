import { describe, expect, it } from "vitest";
import { makeScene } from "../scene";
import { TIME_STEP } from "../simulation";
import { checkConvergence } from "./convergence";
import { defaultProtocol } from "./probes";
import {
  canonicalJson,
  eventOf,
  reproduce,
  reproductionMessage,
  REPRODUCE_TOLERANCE,
  runIdentity,
  runProtocol,
  RUN_SCHEMA,
  valueAt,
} from "./run";
import { referencesFor } from "./theory";

describe("headless motion runs", () => {
  it("cancels a browser preview without changing the result of a completed preview", async () => {
    const scene = makeScene("incline");
    const protocol = defaultProtocol(scene);
    const controller = new AbortController();
    const abandoned = runProtocol(scene, protocol, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    const direct = await runProtocol(scene, protocol);
    const preview = await runProtocol(scene, protocol, {
      signal: new AbortController().signal,
    });
    expect(preview.id).toBe(direct.id);
    expect(preview.stop).toEqual(direct.stop);
    expect(preview.series).toEqual(direct.series);
  });
  it("stops at the protocol's event and samples on the probe grid", async () => {
    const scene = makeScene("incline");
    const run = await runProtocol(scene, defaultProtocol(scene));
    expect(run.schema).toBe(RUN_SCHEMA);
    expect(run.stop.reason).toBe("event");
    expect(run.stop.event?.type).toBe("leaves_ramp");
    expect(eventOf(run, "leaves_ramp", "block-1")?.t).toBe(run.stop.t);
    const { t } = run.series;
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(run.stop.t);
    t.slice(0, -1).forEach((time, index) =>
      expect(time).toBeCloseTo(index / 60, 9),
    );
    for (const column of Object.values(run.series.columns))
      expect(column).toHaveLength(t.length);
    expect(run.series.columns["block-1.acceleration"][0]).toBe(
      run.series.columns["block-1.acceleration"][1],
    );
  });

  it("starts a block on a ramp in contact instead of dropping it", async () => {
    const scene = makeScene("incline");
    const block = scene.objects.find((object) => object.id === "block-1");
    const ramp = scene.objects.find((object) => object.kind === "ramp");
    if (block?.kind !== "block" || ramp?.kind !== "ramp")
      throw new Error("incline template changed");
    const run = await runProtocol(scene, { stop: "time", maxTime: 0.5 });
    const normal = run.series.columns["block-1.normal"];
    const expected =
      block.mass * scene.gravity * Math.cos((ramp.angle * Math.PI) / 180);
    for (const value of normal)
      expect(Math.abs(value - expected) / expected).toBeLessThan(0.01);
    expect(Math.abs(run.series.columns["block-1.vx"][1])).toBeGreaterThan(0);
  });

  it("keeps the probe grid at a finer step", async () => {
    const scene = makeScene("pulley");
    const run = await runProtocol(scene, defaultProtocol(scene), {
      timeStep: TIME_STEP / 4,
    });
    run.series.t
      .slice(0, -1)
      .forEach((time, index) => expect(time).toBeCloseTo(index / 60, 9));
  });

  it("ends at the time limit when the event never comes", async () => {
    const scene = makeScene("friction");
    const run = await runProtocol(
      { ...scene, floorFriction: 0 },
      {
        stop: "rest",
        maxTime: 1,
      },
    );
    expect(run.stop).toEqual({ reason: "time", t: 1 });
    expect(run.events).toEqual([]);
  });

  it("rejects invalid steps, probe rates and protocols", async () => {
    const scene = makeScene("blank");
    const protocol = { stop: "time", maxTime: 1 };
    await expect(runProtocol(scene, protocol, { timeStep: 0 })).rejects.toThrow(
      "time step",
    );
    await expect(
      runProtocol(scene, protocol, { timeStep: 1 / 10 }),
    ).rejects.toThrow("time step");
    await expect(runProtocol(scene, protocol, { rate: 500 })).rejects.toThrow(
      "probe rate",
    );
    await expect(
      runProtocol(scene, { stop: "never", maxTime: 1 }),
    ).rejects.toThrow("stop");
  });

  it("derives a stable identity from the inputs alone", async () => {
    const scene = makeScene("incline");
    const inputs = {
      scene,
      protocol: defaultProtocol(scene),
      timeStep: TIME_STEP,
      rate: 60,
    };
    const reordered = Object.fromEntries(
      Object.entries(inputs).reverse(),
    ) as typeof inputs;
    expect(canonicalJson(reordered)).toBe(canonicalJson(inputs));
    const id = await runIdentity(inputs);
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await runIdentity(reordered)).toBe(id);
    expect(await runIdentity({ ...inputs, timeStep: TIME_STEP / 2 })).not.toBe(
      id,
    );
    expect(
      await runIdentity({ ...inputs, scene: { ...scene, gravity: 9.8 } }),
    ).not.toBe(id);
  });

  it("reproduces a stored run exactly", async () => {
    const scene = makeScene("friction");
    const run = await runProtocol(scene, defaultProtocol(scene));
    const stored = JSON.parse(JSON.stringify(run));
    stored.series.columns = Object.fromEntries(
      Object.entries(stored.series.columns as Record<string, unknown[]>).map(
        ([key, values]) => [
          key,
          values.map((value) => (value === null ? Number.NaN : value)),
        ],
      ),
    );
    const check = await reproduce(stored);
    expect(check).toMatchObject({
      sameIdentity: true,
      sameShape: true,
      identical: true,
      largestDifference: 0,
      sameEngine: true,
    });
  });

  it("tells bit-for-bit, within-tolerance and different re-runs apart", async () => {
    const scene = makeScene("incline");
    const run = await runProtocol(scene, defaultProtocol(scene));
    const key = Object.keys(run.series.columns).find((name) =>
      name.endsWith(".speed"),
    )!;
    const exact = await reproduce(structuredClone(run));
    expect(exact.verdict).toBe("identical");
    expect(reproductionMessage(exact, run)).toEqual({
      tone: "ok",
      message: "The re-run matches the stored run bit for bit.",
    });

    const nudged = structuredClone(run);
    nudged.series.columns[key][5] += 1e-12;
    const within = await reproduce(nudged);
    expect(within.verdict).toBe("within");
    expect(within.largestDifference).toBeGreaterThan(0);
    expect(within.relativeDifference).toBeLessThanOrEqual(REPRODUCE_TOLERANCE);
    expect(reproductionMessage(within, nudged).message).toMatch(
      /^The re-run matches within tolerance/,
    );

    const changed = structuredClone(run);
    changed.series.columns[key][5] += 0.1;
    const different = await reproduce(changed);
    expect(different.verdict).toBe("different");
    expect(reproductionMessage(different, changed)).toMatchObject({
      tone: "warn",
    });

    const missing = structuredClone(run);
    missing.series.columns[key][5] = Number.NaN;
    expect((await reproduce(missing)).verdict).toBe("different");

    const short = structuredClone(run);
    short.series.t.pop();
    for (const name of Object.keys(short.series.columns))
      short.series.columns[name].pop();
    short.engine.version = "0.0.1";
    const shorter = await reproduce(short);
    expect(shorter.verdict).toBe("different");
    expect(reproductionMessage(shorter, short).message).toMatch(
      /recorded \d+ samples where the stored run has \d+\. It was recorded with Rapier 0\.0\.1/,
    );
  });

  it("interpolates a column between samples", async () => {
    const scene = makeScene("pulley");
    const run = await runProtocol(scene, { stop: "time", maxTime: 0.5 });
    const key = "pulley-1.speed";
    const [t1, t2] = [run.series.t[3], run.series.t[4]];
    const [v1, v2] = [run.series.columns[key][3], run.series.columns[key][4]];
    expect(valueAt(run, key, (t1 + t2) / 2)).toBeCloseTo((v1 + v2) / 2, 12);
    expect(valueAt(run, key, -1)).toBe(run.series.columns[key][0]);
    expect(Number.isNaN(valueAt(run, "missing", 0))).toBe(true);
  });
});

describe("timestep convergence", () => {
  it("reports a passing check and its order for the friction stop", async () => {
    const scene = makeScene("friction");
    const reference = referencesFor(scene).find(({ id }) =>
      id.endsWith("friction.d"),
    )!;
    const result = await checkConvergence(
      scene,
      defaultProtocol(scene),
      reference,
    );
    expect(result.steps).toEqual([TIME_STEP, TIME_STEP / 2, TIME_STEP / 4]);
    expect(result.values.every((value) => value !== undefined)).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.change).toBeLessThan(0.01);
    expect(
      result.order === undefined ? result.note : result.order,
    ).toBeTruthy();
  });

  it("explains a check whose run never reaches the event", async () => {
    const scene = { ...makeScene("friction"), floorFriction: 0 };
    const reference = referencesFor(scene).find(({ id }) =>
      id.endsWith("friction.t"),
    )!;
    const result = await checkConvergence(
      scene,
      { stop: "rest", maxTime: 0.5 },
      reference,
    );
    expect(result.passed).toBe(false);
    expect(result.note).toMatch("did not reach the event");
  });
});
