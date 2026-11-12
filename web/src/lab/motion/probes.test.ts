import { describe, expect, it } from "vitest";
import { blockOnRamp, makeObject, makeScene } from "../scene";
import {
  availableStops,
  defaultProtocol,
  lowestOffset,
  parseProtocol,
  protocolFor,
  sceneQuantities,
  SYSTEM,
} from "./probes";
import { runProtocol } from "./run";

describe("motion probes", () => {
  it("offers the stop events each template can raise", () => {
    expect(availableStops(makeScene("incline"))).toEqual([
      "rest",
      "leaves_ramp",
    ]);
    expect(availableStops(makeScene("friction"))).toEqual(["rest"]);
    expect(availableStops(makeScene("projectile"))).toEqual([
      "rest",
      "floor_contact",
    ]);
    expect(availableStops(makeScene("pulley"))).toEqual(["pulley_stop"]);
    expect(availableStops(makeScene("blank"))).toEqual([]);
  });

  it("picks the stop that suits each template", () => {
    expect(defaultProtocol(makeScene("incline")).stop).toBe("leaves_ramp");
    expect(defaultProtocol(makeScene("friction")).stop).toBe("rest");
    expect(defaultProtocol(makeScene("projectile")).stop).toBe("floor_contact");
    expect(defaultProtocol(makeScene("pulley")).stop).toBe("pulley_stop");
    expect(defaultProtocol(makeScene("blank"))).toEqual({
      stop: "time",
      maxTime: 10,
    });
  });

  it("drops a chosen stop the scene cannot raise and keeps its time limit", () => {
    const pulley = makeScene("pulley");
    expect(protocolFor(pulley, { stop: "rest", maxTime: 4 })).toEqual({
      stop: "pulley_stop",
      maxTime: 4,
    });
    expect(protocolFor(pulley, { stop: "time", maxTime: 4 })).toEqual({
      stop: "time",
      maxTime: 4,
    });
    expect(protocolFor(pulley, null)).toEqual(defaultProtocol(pulley));
  });

  it("rejects malformed protocols", () => {
    expect(parseProtocol({ stop: "rest", maxTime: 5 })).toEqual({
      stop: "rest",
      maxTime: 5,
    });
    expect(() => parseProtocol(null)).toThrow("object");
    expect(() => parseProtocol({ stop: "explode", maxTime: 5 })).toThrow(
      "stop",
    );
    expect(() => parseProtocol({ stop: "time", maxTime: 0.1 })).toThrow(
      "time limit",
    );
    expect(() => parseProtocol({ stop: "time", maxTime: 61 })).toThrow(
      "time limit",
    );
    expect(() => parseProtocol({ stop: "time", maxTime: "5" })).toThrow(
      "time limit",
    );
  });

  it("names a column for every block, pulley and system quantity", () => {
    const scene = makeScene("incline");
    scene.objects.push(makeObject("pulley", "pulley-1", 6));
    const keys = sceneQuantities(scene).map(({ key }) => key);
    expect(keys).toContain("block-1.speed");
    expect(keys).toContain("pulley-1.tension");
    expect(keys).toContain(`${SYSTEM}.energy`);
    expect(keys).not.toContain("ramp-1.speed");
    expect(new Set(keys).size).toBe(keys.length);
    const units = Object.fromEntries(
      sceneQuantities(scene).map(({ key, unit }) => [key, unit]),
    );
    expect(units["block-1.acceleration"]).toBe("m/s²");
    expect(units[`${SYSTEM}.px`]).toBe("kg·m/s");
  });

  it("measures a cube's lowest corner from its orientation", () => {
    expect(lowestOffset(1, { x: 0, y: 0, z: 0, w: 1 })).toBeCloseTo(0.5, 12);
    const half = Math.PI / 8;
    expect(
      lowestOffset(1, { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }),
    ).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("conserves energy and horizontal momentum in free flight", async () => {
    const scene = makeScene("projectile");
    const run = await runProtocol(scene, defaultProtocol(scene));
    const block = scene.objects[0];
    if (block.kind !== "block") throw new Error("The template needs a block.");
    const energy = run.series.columns[`${SYSTEM}.energy`];
    const px = run.series.columns[`${SYSTEM}.px`];
    const landing = run.stop.t;
    const initial = energy[0];
    expect(initial).toBeCloseTo(
      block.mass * (scene.gravity * block.y + 0.5 * block.vx ** 2),
      9,
    );
    run.series.t.forEach((t, index) => {
      if (t >= landing) return;
      expect(Math.abs(energy[index] - initial) / initial).toBeLessThan(0.01);
      expect(px[index]).toBeCloseTo(block.mass * block.vx, 6);
    });
  });

  it("raises an event once per target, in time order", async () => {
    const ramp = makeObject("ramp", "ramp-1");
    const scene = makeScene("blank");
    scene.objects = [
      ramp,
      blockOnRamp(makeObject("block", "block-1"), ramp, 0.23, -0.8),
      blockOnRamp(makeObject("block", "block-2"), ramp, 0.5, 0.8),
    ];
    const run = await runProtocol(scene, { stop: "time", maxTime: 4 });
    const leaves = run.events.filter(({ type }) => type === "leaves_ramp");
    expect(leaves.map(({ target }) => target).sort()).toEqual([
      "block-1",
      "block-2",
    ]);
    const times = run.events.map(({ t }) => t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(leaves.find(({ target }) => target === "block-2")!.t).toBeLessThan(
      leaves.find(({ target }) => target === "block-1")!.t,
    );
  });
});
