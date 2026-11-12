import { describe, expect, it } from "vitest";
import { makeObject, makeScene, type LabScene } from "./scene";
import {
  createSimulation,
  PULLEY_TRAVEL,
  pulleyState,
  TIME_STEP,
} from "./simulation";

async function run(scene: LabScene, ticks: number) {
  const simulation = await createSimulation(scene);
  try {
    simulation.step(ticks);
    const state = simulation.block("block-1");
    if (!state) throw new Error("The fixture needs a block-1.");
    return { ...state, time: simulation.time };
  } finally {
    simulation.dispose();
  }
}

describe("mechanics simulation", () => {
  it("repeats identical runs and advances by a fixed step", async () => {
    const scene = makeScene("incline");
    const first = await run(scene, 120);
    const second = await run(scene, 120);
    expect(first).toEqual(second);
    expect(first.time).toBe(1);
    expect(first.position.x).toBeGreaterThan(-0.9);
    expect(first.position.y).toBeLessThan(3);
  });

  it("slows a block when floor friction increases", async () => {
    const scene = makeScene("friction");
    const smooth = await run({ ...scene, floorFriction: 0 }, 120);
    const rough = await run({ ...scene, floorFriction: 0.8 }, 120);
    expect(smooth.velocity.x).toBeCloseTo(5, 3);
    expect(rough.velocity.x).toBeCloseTo(0, 1);
    expect(rough.position.x).toBeLessThan(smooth.position.x);
  });

  it("uses the ramp friction in inclined contact", async () => {
    const scene = makeScene("incline");
    const rough = {
      ...scene,
      objects: scene.objects.map((part) =>
        part.kind === "ramp" ? { ...part, friction: 0.95 } : part,
      ),
    };
    const sliding = await run(scene, 90);
    const holding = await run(rough, 90);
    expect(sliding.position.x - holding.position.x).toBeGreaterThan(0.45);
    expect(
      Math.hypot(holding.velocity.x, holding.velocity.y, holding.velocity.z),
    ).toBeLessThan(0.1);
  });

  it("rejects invalid input and step counts before changing simulation time", async () => {
    await expect(
      createSimulation({ ...makeScene("blank"), gravity: -1 }),
    ).rejects.toThrow("gravity");
    const simulation = await createSimulation(makeScene("blank"));
    try {
      expect(() => simulation.step(0.5)).toThrow("Step count");
      expect(simulation.time).toBe(0);
      simulation.step();
      expect(simulation.time).toBe(TIME_STEP);
    } finally {
      simulation.dispose();
    }
    expect(() => simulation.step()).toThrow("disposed");
    expect(() => simulation.dispose()).not.toThrow();
  });
});

describe("ideal pulley", () => {
  it("reproduces the Atwood acceleration and tension", async () => {
    const scene = makeScene("pulley");
    const simulation = await createSimulation(scene);
    try {
      simulation.step(60);
      const result = simulation.pulley("pulley-1");
      expect(result?.displacement).toBeCloseTo(0.24525);
      expect(result?.speed).toBeCloseTo(0.981);
      expect(result?.acceleration).toBeCloseTo(1.962);
      expect(result?.tension).toBeCloseTo(23.544);
    } finally {
      simulation.dispose();
    }
  });

  it("holds equal masses still and stops either direction at the travel limit", () => {
    const pulley = makeObject("pulley", "pulley");
    expect(pulleyState({ ...pulley, rightMass: 2 }, 9.81, 10)).toEqual({
      displacement: 0,
      speed: 0,
      acceleration: 0,
      tension: 19.62,
      stopped: false,
    });
    expect(pulleyState({ ...pulley, leftMass: 4 }, 9.81, 10)).toEqual({
      displacement: -PULLEY_TRAVEL,
      speed: 0,
      acceleration: 0,
      tension: null,
      stopped: true,
    });
  });
});
