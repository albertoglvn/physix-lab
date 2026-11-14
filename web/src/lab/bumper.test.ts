import { describe, expect, it } from "vitest";
import { buildScene, SceneRequestError } from "./buildScene";
import { movableAxes } from "./moveGizmo";
import {
  createRecorder,
  defaultProtocol,
  sceneQuantities,
} from "./motion/probes";
import {
  bumperFace,
  makeObject,
  makeScene,
  parseScene,
  type Block,
  type Bumper,
  type LabScene,
} from "./scene";
import { bumperCompression, bumperPush, createSimulation } from "./simulation";

/** A 2 kg block sliding at `speed` along a frictionless floor into a bumper. */
function headOn(speed: number, bumper: Partial<Bumper> = {}): LabScene {
  const wall: Bumper = { ...makeObject("bumper", "bumper-1", 4), ...bumper };
  const direction = wall.facing === "left" ? 1 : -1;
  const block: Block = {
    ...makeObject("block", "block-1", wall.x - direction * 4),
    y: 0.5,
    vx: direction * speed,
  };
  return {
    ...makeScene("blank"),
    floorFriction: 0,
    objects: [block, wall],
  };
}

async function collide(scene: LabScene, seconds: number) {
  const simulation = await createSimulation(scene);
  const block = scene.objects[0] as Block;
  try {
    let deepest = 0;
    let drift = 0;
    const energy = () => {
      const { velocity } = simulation.block(block.id)!;
      const kinetic = 0.5 * block.mass * velocity.x ** 2;
      return kinetic + simulation.bumper("bumper-1")!.elastic;
    };
    const start = energy();
    const steps = Math.round(seconds / simulation.timeStep);
    for (let i = 0; i < steps; i++) {
      simulation.step(1);
      deepest = Math.max(deepest, simulation.bumper("bumper-1")!.compression);
      drift = Math.max(drift, Math.abs(energy() - start) / start);
    }
    const { velocity } = simulation.block(block.id)!;
    return { deepest, drift, vx: velocity.x };
  } finally {
    simulation.dispose();
  }
}

describe("bumper scene contract", () => {
  it("defaults to a left-facing pad on a 400 N/m spring", () => {
    const bumper = makeObject("bumper", "b", 6);
    expect(bumper).toMatchObject({
      facing: "left",
      stiffness: 400,
      damping: 0,
      restLength: 1.2,
    });
    expect(bumperFace(bumper)).toBeCloseTo(6 - 0.1 - 1.2, 12);
    expect(bumperFace({ ...bumper, facing: "right" })).toBeCloseTo(7.3, 12);
  });

  it("round-trips the ramp-into-bumper template and rejects a bad facing", () => {
    const scene = makeScene("bumper");
    expect(parseScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    const bumper = { ...makeObject("bumper", "b"), facing: "up" };
    expect(() =>
      parseScene({ ...makeScene("blank"), objects: [bumper] }),
    ).toThrow("A bumper faces left or right.");
  });

  it("stands on the floor, so the move arrows skip Y", () => {
    expect(movableAxes(makeObject("bumper", "b"))).toEqual(["x", "z"]);
  });
});

describe("bumper spring law", () => {
  const bumper = makeObject("bumper", "b", 4);
  const block = { ...makeObject("block", "k", 0), y: 0.5 };

  it("measures compression from the pad face to the body's leading edge", () => {
    const face = bumperFace(bumper);
    expect(
      bumperCompression(bumper, block, { x: face - 0.6, y: 0.5, z: 0 }),
    ).toBe(0);
    expect(
      bumperCompression(bumper, block, { x: face - 0.3, y: 0.5, z: 0 }),
    ).toBeCloseTo(0.2, 12);
  });

  it("ignores bodies above the wall, beside it, or behind it", () => {
    const face = bumperFace(bumper);
    const at = (x: number, y: number, z: number) =>
      bumperCompression(bumper, block, { x, y, z });
    expect(at(face, 2, 0)).toBe(0);
    expect(at(face, 0.5, 2)).toBe(0);
    expect(at(bumper.x + 1, 0.5, 0)).toBe(0);
  });

  it("pushes only, with the damper resisting the approach", () => {
    expect(bumperPush(bumper, 0, 3)).toBe(0);
    expect(bumperPush(bumper, 0.1, 0)).toBeCloseTo(40, 12);
    const damped = { ...bumper, damping: 20 };
    expect(bumperPush(damped, 0.1, 1)).toBeCloseTo(60, 12);
    expect(bumperPush(damped, 0.1, -5)).toBe(0);
  });
});

describe("simulated bumper", () => {
  it("stops a sliding block at v√(m/k) and returns it at the same speed", async () => {
    const speed = 4;
    const { deepest, drift, vx } = await collide(headOn(speed), 3);
    // docs/CONTRACTS.md quotes these bounds.
    expect(Math.abs(deepest / (speed * Math.sqrt(2 / 400)) - 1)).toBeLessThan(
      0.002,
    );
    expect(Math.abs(-vx / speed - 1)).toBeLessThan(0.002);
    expect(drift).toBeLessThan(0.005);
  });

  it("works facing right", async () => {
    const { deepest, vx } = await collide(
      headOn(3, { facing: "right", x: -4 }),
      3,
    );
    expect(deepest).toBeCloseTo(3 * Math.sqrt(2 / 400), 2);
    expect(vx).toBeCloseTo(3, 1);
  });

  it("loses energy to the damper", async () => {
    const { vx } = await collide(headOn(4, { damping: 20 }), 3);
    expect(vx).toBeLessThan(0);
    expect(Math.abs(vx)).toBeLessThan(3.5);
  });
});

describe("bumper probes and requests", () => {
  it("plots compression, force and elastic energy, and runs on a timer", async () => {
    const scene = makeScene("bumper");
    const keys = sceneQuantities(scene).map(({ key }) => key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "bumper-1.compression",
        "bumper-1.force",
        "bumper-1.elastic",
      ]),
    );
    expect(defaultProtocol(scene)).toEqual({ stop: "time", maxTime: 10 });
    const simulation = await createSimulation(scene);
    try {
      const recorder = createRecorder(scene, simulation);
      expect(recorder).toBeDefined();
    } finally {
      simulation.dispose();
    }
  });

  it("builds a bumper from an agent request and rejects an unknown facing", () => {
    const { scene } = buildScene({
      objects: [{ kind: "bumper", facing: "right", stiffness: 900 }],
    });
    expect(scene.objects[0]).toMatchObject({
      kind: "bumper",
      facing: "right",
      stiffness: 900,
    });
    expect(() =>
      buildScene({ objects: [{ kind: "bumper", facing: "up" }] }),
    ).toThrow(SceneRequestError);
  });
});
