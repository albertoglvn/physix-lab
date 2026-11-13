import { describe, expect, it } from "vitest";
import {
  makeObject,
  makeScene,
  radians,
  springEquilibrium,
  type LabScene,
} from "./scene";
import { createSimulation, TIME_STEP } from "./simulation";

/** Samples one coordinate of a body every step for `seconds`. */
async function trace(
  scene: LabScene,
  id: string,
  read: (state: { x: number; y: number }) => number,
  seconds: number,
) {
  const simulation = await createSimulation(scene);
  try {
    const t: number[] = [];
    const v: number[] = [];
    for (let tick = 0; tick <= Math.round(seconds / TIME_STEP); tick++) {
      if (tick) simulation.step();
      t.push(simulation.time);
      v.push(read(simulation.block(id)!.position));
    }
    return { t, v };
  } finally {
    simulation.dispose();
  }
}

/** Mean period from linearly interpolated upward crossings of `level`. */
function period({ t, v }: { t: number[]; v: number[] }, level: number) {
  const crossings: number[] = [];
  for (let i = 1; i < v.length; i++)
    if (v[i - 1] < level && v[i] >= level)
      crossings.push(
        t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]),
      );
  return (
    (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)
  );
}

describe("pendulum", () => {
  it("swings with the physical-pendulum period at small amplitude", async () => {
    const scene = makeScene("pendulum");
    const pendulum = { ...makeObject("pendulum", "pendulum-1"), angle: 4 };
    const { length: L, bobRadius: r } = pendulum;
    const expected =
      2 * Math.PI * Math.sqrt((L * L + 0.4 * r * r) / (scene.gravity * L));
    const swing = await trace(
      { ...scene, objects: [pendulum] },
      "pendulum-1",
      (p) => p.x,
      12,
    );
    expect(Math.abs(period(swing, 0) / expected - 1)).toBeLessThan(2e-3);
  });

  it("keeps the rod length and lengthens the period at large amplitude", async () => {
    const scene = makeScene("pendulum");
    const pendulum = { ...makeObject("pendulum", "pendulum-1"), angle: 60 };
    const simulation = await createSimulation({
      ...scene,
      objects: [pendulum],
    });
    try {
      let worst = 0;
      for (let tick = 0; tick < 600; tick++) {
        simulation.step();
        const { x, y } = simulation.block("pendulum-1")!.position;
        worst = Math.max(
          worst,
          Math.abs(Math.hypot(x, y - pendulum.pivotHeight) - pendulum.length),
        );
      }
      expect(worst).toBeLessThan(2e-3);
    } finally {
      simulation.dispose();
    }
    const swing = await trace(
      { ...scene, objects: [pendulum] },
      "pendulum-1",
      (p) => p.x,
      12,
    );
    const small =
      2 *
      Math.PI *
      Math.sqrt(
        (pendulum.length ** 2 + 0.4 * pendulum.bobRadius ** 2) /
          (scene.gravity * pendulum.length),
      );
    // K(sin 30°) / (π/2) = 1.07318 for a 60° release.
    expect(period(swing, 0) / small).toBeCloseTo(1.0732, 2);
  });
});

describe("spring oscillator", () => {
  it("oscillates about equilibrium with the undamped period", async () => {
    const scene = makeScene("spring");
    const spring = makeObject("spring", "spring-1");
    const centre = springEquilibrium(spring, scene.gravity);
    const motion = await trace(scene, "spring-1", (p) => p.y, 8);
    const expected = 2 * Math.PI * Math.sqrt(spring.mass / spring.stiffness);
    expect(Math.abs(period(motion, centre) / expected - 1)).toBeLessThan(2e-3);
    expect(Math.max(...motion.v) - centre).toBeCloseTo(spring.offset, 2);
    expect(centre - Math.min(...motion.v)).toBeCloseTo(spring.offset, 2);
  });

  it("decays with damping at the damped period", async () => {
    const scene = makeScene("spring");
    const spring = { ...makeObject("spring", "spring-1"), damping: 2 };
    const centre = springEquilibrium(spring, scene.gravity);
    const motion = await trace(
      { ...scene, objects: [spring] },
      "spring-1",
      (p) => p.y,
      8,
    );
    const w0 = Math.sqrt(spring.stiffness / spring.mass);
    const zeta =
      spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
    const expected = (2 * Math.PI) / (w0 * Math.sqrt(1 - zeta * zeta));
    expect(Math.abs(period(motion, centre) / expected - 1)).toBeLessThan(3e-3);
    const late = motion.v.slice(-120).map((y) => Math.abs(y - centre));
    expect(Math.max(...late)).toBeLessThan(
      spring.offset * Math.exp(-zeta * w0 * 7) * 1.05,
    );
  });
});

describe("rolling ball", () => {
  it("rolls down the ramp at five sevenths of g sin θ", async () => {
    const scene = makeScene("rolling");
    const ramp = scene.objects.find((part) => part.kind === "ramp")!;
    if (ramp.kind !== "ramp") throw new Error("The template needs a ramp.");
    const simulation = await createSimulation(scene);
    try {
      simulation.step(30);
      const a = simulation.block("ball-1")!.velocity;
      simulation.step(60);
      const b = simulation.block("ball-1")!.velocity;
      const measured =
        (Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y)) / (60 * TIME_STEP);
      const expected = (5 / 7) * scene.gravity * Math.sin(radians(ramp.angle));
      expect(Math.abs(measured / expected - 1)).toBeLessThan(0.02);
    } finally {
      simulation.dispose();
    }
  });
});
