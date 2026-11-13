import { describe, expect, it } from "vitest";
import {
  blockOnRamp,
  makeObject,
  makeScene,
  type Ball,
  type Cylinder,
} from "../scene";
import {
  availableStops,
  bodyLowest,
  defaultProtocol,
  headOnPairs,
  lowestOffset,
  parseProtocol,
  protocolFor,
  rotationalEnergy,
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

  it("records contact forces and link tension from the first sample", async () => {
    const friction = makeScene("friction");
    const slide = await runProtocol(friction, { stop: "time", maxTime: 0.5 });
    const normal = slide.series.columns["block-1.normal"];
    const grip = slide.series.columns["block-1.friction"];
    expect(normal.every(Number.isFinite)).toBe(true);
    expect(normal[0]).toBe(normal[1]);
    expect(normal[10]).toBeCloseTo(2 * 9.81, 2);
    expect(grip[10]).toBeCloseTo(0.35 * 2 * 9.81, 2);
    const units = Object.fromEntries(
      sceneQuantities(friction).map(({ key, unit, source }) => [
        key,
        [unit, source],
      ]),
    );
    expect(units["block-1.normal"]).toEqual(["N", "rapier"]);
    const compound = makeScene("compound");
    const swing = await runProtocol(compound, { stop: "time", maxTime: 1 });
    const tension = swing.series.columns["pendulum-1.tension"];
    expect(tension.every(Number.isFinite)).toBe(true);
    // At release the rod and bob pull (m + M) g cos θ₀ along the rod.
    expect(tension[1]).toBeCloseTo(3 * 9.81 * Math.cos((8 * Math.PI) / 180), 1);
  });

  it("keeps a compound pendulum's energy and reads the swing rate of a rope", async () => {
    const compound = makeScene("compound");
    const swing = await runProtocol(compound, { stop: "time", maxTime: 2 });
    const energy = swing.series.columns[`${SYSTEM}.energy`];
    const spread = Math.max(...energy) - Math.min(...energy);
    expect(spread / Math.abs(energy[0])).toBeLessThan(1e-3);
    const rope = makeScene("rope");
    const fall = await runProtocol(rope, { stop: "time", maxTime: 1.5 });
    const omega = fall.series.columns["pendulum-1.omega"];
    // Taut and swinging after the jerk at about 0.78 s.
    expect(Math.abs(omega[omega.length - 1])).toBeGreaterThan(1);
  });

  it("stops a bounce on its first rebound and a collision after both speeds settle", () => {
    expect(availableStops(makeScene("bounce"))).toEqual(
      expect.arrayContaining(["floor_contact", "bounce", "rest"]),
    );
    expect(defaultProtocol(makeScene("bounce")).stop).toBe("bounce");
    expect(defaultProtocol(makeScene("launcher")).stop).toBe("bounce");
    // The balls close 3.4 m at 3 m/s: impact at 1.13 s, so the run lasts 3 s.
    expect(defaultProtocol(makeScene("collision"))).toEqual({
      stop: "time",
      maxTime: 3,
    });
    expect(availableStops(makeScene("collision"))).toContain("collision");
  });

  it("pairs equal balls meeting head on and nothing else", () => {
    const scene = makeScene("collision");
    const [striker, target] = scene.objects as Ball[];
    expect(headOnPairs(scene)).toEqual([[striker, target]]);
    expect(headOnPairs({ ...scene, floorFriction: 0.3 })).toEqual([]);
    const apart = { ...scene, objects: [striker, { ...target, z: 1 }] };
    expect(headOnPairs(apart)).toEqual([]);
    const larger = { ...target, radius: 0.4, y: 0.4 };
    expect(headOnPairs({ ...scene, objects: [striker, larger] })).toEqual([]);
    const away = { ...scene, objects: [{ ...striker, vx: -3 }, target] };
    expect(headOnPairs(away)).toEqual([]);
    const middle = { ...target, id: "ball-3", x: -2 };
    expect(
      headOnPairs({ ...scene, objects: [striker, target, middle] }),
    ).toEqual([[striker, middle]]);
  });

  it("finds a cylinder's lowest point and spin energy from its axis", () => {
    const cylinder = makeObject("cylinder", "c") as Cylinder;
    const level = { x: 0, y: 0, z: 0, w: 1 };
    expect(bodyLowest(cylinder, level)).toBeCloseTo(cylinder.radius, 12);
    // A quarter turn about x stands the axis upright.
    const upright = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    expect(bodyLowest(cylinder, upright)).toBeCloseTo(cylinder.length / 2, 12);
    const { mass, radius, length } = cylinder;
    const roll = { x: 0, y: 0, z: 2 };
    expect(rotationalEnergy(cylinder, level, roll)).toBeCloseTo(
      ((0.5 * (mass * radius ** 2)) / 2) * 4,
      12,
    );
    const tumble = { x: 2, y: 0, z: 0 };
    expect(rotationalEnergy(cylinder, level, tumble)).toBeCloseTo(
      ((0.5 * mass * (3 * radius ** 2 + length ** 2)) / 12) * 4,
      12,
    );
    const ball = makeObject("ball", "b") as Ball;
    expect(rotationalEnergy(ball, level, roll)).toBeCloseTo(
      0.2 * ball.mass * ball.radius ** 2 * 4,
      12,
    );
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
