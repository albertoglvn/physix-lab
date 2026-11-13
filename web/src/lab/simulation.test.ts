import { describe, expect, it } from "vitest";
import { makeObject, makeScene, type LabScene, type Pulley } from "./scene";
import {
  atwood,
  createSimulation,
  dragStepForce,
  initialPulleyState,
  PULLEY_RADIUS,
  PULLEY_TRAVEL,
  PULLEY_WEIGHT_HEIGHT,
  stepAtwood,
  TIME_STEP,
  WEIGHT_HIGH,
  WEIGHT_LOW,
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

describe("applied forces and air drag", () => {
  it("makes one engine step follow the exact drag solution", () => {
    const h = 0.05;
    const v = { x: 3, y: -2, z: 0 };
    const a = { x: 0, y: -9.81, z: 0 };
    expect(dragStepForce(v, a, 2, 0, 0, h)).toEqual({ x: 0, y: 0, z: 0 });
    // Linear drag only: v(h) = v e^(−kh) + a (1 − e^(−kh))/k.
    const k = 0.8 / 2;
    const f = dragStepForce(v, a, 2, 0.8, 0, h);
    const next = (vi: number, ai: number, fi: number) => vi + h * (ai + fi / 2);
    const exact = (vi: number, ai: number) =>
      vi * Math.exp(-k * h) + (ai * -Math.expm1(-k * h)) / k;
    expect(next(v.x, a.x, f.x)).toBeCloseTo(exact(v.x, a.x), 12);
    expect(next(v.y, a.y, f.y)).toBeCloseTo(exact(v.y, a.y), 12);
    // At terminal speed quadratic drag cancels gravity.
    const c = 0.05;
    const terminal = Math.sqrt((2 * 9.81) / c);
    const hold = dragStepForce({ x: 0, y: -terminal, z: 0 }, a, 2, 0, c, h);
    expect(hold.y).toBeCloseTo(2 * 9.81, 9);
    expect(Math.abs(hold.x)).toBe(0);
  });

  it("reaches the closed-form speeds under a push and under quadratic drag", async () => {
    const push = await createSimulation(makeScene("push"));
    push.step(120);
    // (10 − 0.35 · 2 · 9.81) / 2 m/s² for 1 s, to within the engine's first step.
    expect(push.block("block-1")!.velocity.x).toBeCloseTo(1.5665, 2);
    push.dispose();
    const scene = makeScene("drag");
    const drop = await createSimulation(scene);
    drop.step(120);
    const c = 0.5 * 1.2 * 0.47 * Math.PI * 0.09;
    const terminal = Math.sqrt((0.5 * 9.81) / c);
    expect(-drop.block("ball-1")!.velocity.y).toBeCloseTo(
      terminal * Math.tanh(9.81 / terminal),
      4,
    );
    drop.dispose();
  });
});

describe("simulated pulley", () => {
  const h = TIME_STEP;
  const g = 9.81;
  const pulley = (changes: Partial<Pulley> = {}): Pulley => ({
    ...makeObject("pulley", "pulley-1"),
    ...changes,
  });
  function settle(part: Pulley, steps: number) {
    let state = initialPulleyState(part, g);
    for (let i = 0; i < steps; i++) state = stepAtwood(part, g, state, h);
    return state;
  }

  it("agrees with the ideal Atwood machine when the wheel is massless", async () => {
    const scene = makeScene("pulley");
    const simulation = await createSimulation(scene);
    try {
      simulation.step(60);
      const result = simulation.pulley("pulley-1");
      const a = (g * (3 - 2)) / 5;
      expect(result?.acceleration).toBeCloseTo(a, 12);
      expect(result?.tension).toBeCloseTo((2 * 2 * 3 * g) / 5, 12);
      expect(result?.rightTension).toBeCloseTo((2 * 2 * 3 * g) / 5, 12);
      expect(result?.speed).toBeCloseTo(a * 0.5, 12);
      expect(result?.displacement).toBeCloseTo((a * 0.25) / 2, 12);
      expect(result!.left.y + result!.right.y).toBeCloseTo(
        2 * PULLEY_WEIGHT_HEIGHT,
        12,
      );
      expect(result?.taut).toBe(true);
    } finally {
      simulation.dispose();
    }
  });

  it("slows the rope by the wheel's inertia and splits the tension", () => {
    const part = pulley({ wheelMass: 2 });
    const ideal = atwood(part, g);
    expect(ideal.acceleration).toBeCloseTo(g / 6, 12);
    const state = settle(part, 60);
    expect(state.acceleration).toBeCloseTo(g / 6, 12);
    expect(state.tension).toBeCloseTo(2 * (g + g / 6), 12);
    expect(state.rightTension).toBeCloseTo(3 * (g - g / 6), 12);
    expect(state.wheelSpeed).toBeCloseTo(state.speed, 12);
    expect(state.wheelAngle).toBeCloseTo(state.displacement / PULLEY_RADIUS, 9);
    // Energy holds while the rope is taut: K of both weights and the disc against U.
    const kinetic =
      0.5 * 5 * state.speed ** 2 + 0.25 * part.wheelMass * state.speed ** 2;
    expect(kinetic).toBeCloseTo(g * (3 - 2) * state.displacement, 9);
  });

  it("holds equal masses still", () => {
    const state = settle(pulley({ rightMass: 2 }), 600);
    expect(state.displacement).toBe(0);
    expect(state.speed).toBe(0);
    expect(state.tension).toBeCloseTo(2 * g, 12);
    expect(state.stopped).toBe(false);
  });

  it("lands the heavier weight, lets the rope go slack, then settles", () => {
    for (const [leftMass, rightMass] of [
      [2, 3],
      [3, 2],
    ]) {
      const part = pulley({ leftMass, rightMass });
      const a = atwood(part, g).acceleration;
      let state = initialPulleyState(part, g);
      let landing = 0;
      let slack = false;
      for (let i = 1; i <= 1200; i++) {
        state = stepAtwood(part, g, state, h);
        if (!landing && state.stopped) landing = i * h;
        if (landing && !state.taut) slack = true;
      }
      const ideal = Math.sqrt((2 * PULLEY_TRAVEL) / Math.abs(a));
      expect(landing).toBeGreaterThanOrEqual(ideal);
      expect(landing - ideal).toBeLessThanOrEqual(h);
      expect(slack).toBe(true);
      const heavy = rightMass > leftMass ? state.right : state.left;
      const light = rightMass > leftMass ? state.left : state.right;
      expect(heavy.y).toBeCloseTo(WEIGHT_LOW, 12);
      expect(light.y).toBeCloseTo(2 * PULLEY_WEIGHT_HEIGHT - WEIGHT_LOW, 12);
      expect(state.speed).toBe(0);
      expect(state.tension).toBeCloseTo(Math.min(leftMass, rightMass) * g, 9);
      expect(state.taut).toBe(true);
    }
  });

  it("stops a fast rising weight at the wheel and keeps it there", () => {
    const part = pulley({ leftMass: 0.1, rightMass: 100 });
    let highest = 0;
    let state = initialPulleyState(part, g);
    for (let i = 0; i < 600; i++) {
      state = stepAtwood(part, g, state, h);
      highest = Math.max(highest, state.left.y);
    }
    expect(highest).toBeCloseTo(WEIGHT_HIGH, 12);
    expect(state.right.y).toBeCloseTo(WEIGHT_LOW, 12);
  });

  it("moves the engine's weights with the rope model", async () => {
    const scene = makeScene("pulley");
    const simulation = await createSimulation(scene);
    try {
      simulation.step(30);
      let state = initialPulleyState(scene.objects[0] as Pulley, g);
      for (let i = 0; i < 30; i++)
        state = stepAtwood(scene.objects[0] as Pulley, g, state, h);
      expect(simulation.pulley("pulley-1")).toEqual(state);
    } finally {
      simulation.dispose();
    }
  });
});
