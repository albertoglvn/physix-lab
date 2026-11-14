import { describe, expect, it } from "vitest";
import {
  blockOnRamp,
  densityMass,
  dragCoefficientOf,
  dragCoefficients,
  findRampPlacement,
  forceOver,
  frontalArea,
  launchOf,
  launchVelocity,
  LEGACY_RAMP_CLEARANCE,
  makeObject,
  MATERIALS,
  makeScene,
  movePart,
  OBJECT_LIMIT,
  parseScene,
  RAMP_CLEARANCE,
  rampHeight,
  rampPlacement,
  SCENE_VERSION,
  withMaterial,
  type Ball,
  type Pendulum,
  type Preset,
  type Pulley,
} from "./scene";

describe("mechanics scene contract", () => {
  it("moves a ramp and its placed body together within the scene bounds", () => {
    const original = makeScene("incline");
    const [ramp, body] = original.objects;
    const result = movePart(original, ramp.id, { x: 25, y: 3, z: -4 });
    const [movedRamp, movedBody] = result.objects;
    expect(movedRamp.x).toBe(20);
    expect(movedBody.x - movedRamp.x).toBeCloseTo(body.x - ramp.x);
    expect(movedBody.z).toBe(body.z - 4);
    expect(parseScene(result)).toEqual(result);
    expect(original.objects[0].x).toBe(0);
    expect(movePart(result, ramp.id, { x: 1, y: 0, z: 0 })).toBe(result);
  });

  it("lifts bodies and pendulum pivots without changing launch settings", () => {
    const projectile = makeScene("projectile");
    const body = projectile.objects[0];
    const raised = movePart(projectile, body.id, { x: 0, y: 100, z: 0 });
    expect(raised.objects[0]).toEqual({ ...body, y: 20 });
    expect(movePart(raised, body.id, { x: 0, y: 1, z: 0 })).toBe(raised);
    expect(movePart(projectile, body.id, { x: NaN, y: 0, z: 0 })).toBe(
      projectile,
    );
    const pendulum = makeScene("pendulum");
    const pivot = pendulum.objects[0] as Pendulum;
    const lowered = movePart(pendulum, pivot.id, { x: 0, y: -20, z: 0 });
    expect((lowered.objects[0] as Pendulum).pivotHeight).toBeCloseTo(
      pivot.length + pivot.bobRadius + 0.05,
    );
    expect(parseScene(lowered)).toEqual(lowered);
  });
  it.each<Preset>([
    "incline",
    "friction",
    "projectile",
    "pulley",
    "rolling",
    "pendulum",
    "spring",
    "launcher",
    "bounce",
    "collision",
    "push",
    "drag",
    "compound",
    "rope",
    "blank",
  ])("round-trips %s", (preset) => {
    const scene = makeScene(preset);
    expect(parseScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
  });

  it("rejects unsupported versions, object types, duplicate IDs and out-of-range values", () => {
    const scene = makeScene("incline");
    expect(() => parseScene({ ...scene, version: "physix.lab/3" })).toThrow(
      "version",
    );
    expect(() => parseScene({ ...scene, gravity: Infinity })).toThrow(
      "gravity",
    );
    expect(() =>
      parseScene({ ...scene, objects: [scene.objects[0], scene.objects[0]] }),
    ).toThrow("unique ID");
    expect(() =>
      parseScene({
        ...scene,
        objects: [{ ...scene.objects[0], kind: "rope" }],
      }),
    ).toThrow("Supported objects");
    expect(() =>
      parseScene({
        ...scene,
        objects: Array(OBJECT_LIMIT + 1).fill(scene.objects[0]),
      }),
    ).toThrow("up to");
    expect(() =>
      parseScene({
        ...scene,
        objects: [{ ...makeObject("block", "body"), mass: 0 }],
      }),
    ).toThrow("mass");
  });

  it("migrates a physix.lab/1 file to the current version", () => {
    const legacy = { ...makeScene("incline"), version: "physix.lab/1" };
    const parsed = parseScene(JSON.parse(JSON.stringify(legacy)));
    expect(parsed.version).toBe(SCENE_VERSION);
    expect(parsed.objects).toEqual(legacy.objects);
    expect(() =>
      parseScene({ ...makeScene("rolling"), version: "physix.lab/1" }),
    ).toThrow("physix.lab/2");
  });

  it("defaults a body's vertical speed and restitution and checks its surface", () => {
    const scene = makeScene("projectile");
    const bare: Record<string, unknown> = { ...scene.objects[0] };
    delete bare.vy;
    delete bare.restitution;
    const [parsed] = parseScene({ ...scene, objects: [bare] }).objects;
    expect(parsed).toEqual({ ...bare, vy: 0, restitution: 0 });
    expect(parsed).not.toHaveProperty("friction");
    expect(parsed).not.toHaveProperty("material");
    const objects = (patch: Record<string, unknown>) => ({
      ...scene,
      objects: [{ ...bare, ...patch }],
    });
    expect(() => parseScene(objects({ material: "glass" }))).toThrow(
      "material must be one of wood, steel, rubber, ice, felt.",
    );
    expect(() => parseScene(objects({ restitution: 1.2 }))).toThrow(
      "restitution",
    );
    expect(() => parseScene(objects({ friction: -0.1 }))).toThrow("friction");
    expect(parseScene(objects({ friction: 0.3 })).objects[0]).toMatchObject({
      friction: 0.3,
    });
  });

  it("parses air, drag coefficients and applied forces, and refuses bad ones", () => {
    const scene = makeScene("push");
    const plain = JSON.parse(JSON.stringify(scene));
    delete plain.airDensity;
    delete plain.linearDrag;
    const parsed = parseScene(plain);
    expect(parsed.airDensity).toBe(0);
    expect(parsed.linearDrag).toBe(0);
    expect(parsed.objects[0]).toMatchObject({
      force: { x: 10, y: 0, start: 0, end: 1 },
    });
    const withForce = (force: unknown) =>
      parseScene({ ...plain, objects: [{ ...plain.objects[0], force }] });
    expect(() => withForce({ x: 10, y: 0, start: 1, end: 1 })).toThrow(
      "A force must end after it starts.",
    );
    expect(() => withForce({ x: 900, y: 0, start: 0, end: 1 })).toThrow(
      "force.x must be a number between -500 and 500.",
    );
    expect(() => withForce({ x: 1, y: 0, start: 0 })).toThrow(/force\.end/);
    expect(() => parseScene({ ...plain, airDensity: -1 })).toThrow(
      /airDensity/,
    );
    const air = makeScene("drag");
    const drag = JSON.parse(JSON.stringify(air));
    drag.objects[0].dragCoefficient = 3;
    expect(() => parseScene(drag)).toThrow(/dragCoefficient/);
    drag.objects[0].dragCoefficient = 0.3;
    expect(parseScene(drag).objects[0]).toMatchObject({
      dragCoefficient: 0.3,
    });
  });

  it("derives drag from the shape, the air and the body's coefficient", () => {
    const scene = { ...makeScene("blank"), airDensity: 1.2, linearDrag: 0.1 };
    const ball = { ...makeObject("ball", "ball-1"), radius: 0.3 } as Ball;
    expect(frontalArea(ball)).toBeCloseTo(Math.PI * 0.09, 12);
    expect(dragCoefficientOf(ball)).toBe(0.47);
    const { linear, quadratic } = dragCoefficients(ball, scene);
    expect(linear).toBe(0.1);
    expect(quadratic).toBeCloseTo(0.5 * 1.2 * 0.47 * Math.PI * 0.09, 12);
    expect(dragCoefficientOf({ ...ball, dragCoefficient: 0.2 })).toBe(0.2);
    const block = makeObject("block", "block-1");
    if (block.kind !== "block") throw new Error("Expected a block.");
    expect(frontalArea(block)).toBeCloseTo(block.size ** 2, 12);
    const cylinder = makeObject("cylinder", "cylinder-1");
    if (cylinder.kind !== "cylinder") throw new Error("Expected a cylinder.");
    expect(frontalArea(cylinder)).toBeCloseTo(
      2 * cylinder.radius * cylinder.length,
      12,
    );
  });

  it("spreads a force over the part of each step it covers", () => {
    const body = { vx: 0, vy: 0, force: { x: 12, y: -6, start: 0.5, end: 1 } };
    expect(forceOver(body, 0.4, 0.05)).toEqual({ x: 0, y: 0 });
    expect(forceOver(body, 0.5, 0.25)).toEqual({ x: 12, y: -6 });
    const edge = forceOver(body, 0.48, 0.04);
    expect(edge.x).toBeCloseTo(6, 12);
    expect(edge.y).toBeCloseTo(-3, 12);
    expect(forceOver({ vx: 0, vy: 0 }, 0, 0.01)).toEqual({ x: 0, y: 0 });
    // The impulse is exact whatever the step.
    for (const h of [1 / 120, 0.07, 0.3]) {
      let impulse = 0;
      for (let t = 0; t < 2; t += h) impulse += forceOver(body, t, h).x * h;
      expect(impulse).toBeCloseTo(6, 9);
    }
  });

  it("parses a cylinder and refuses one without its length", () => {
    const scene = makeScene("blank");
    const cylinder = makeObject("cylinder", "cylinder-1");
    expect(cylinder).toMatchObject({
      kind: "cylinder",
      radius: 0.4,
      length: 1,
      y: 0.4,
      vx: 0,
      vy: 0,
      restitution: 0,
    });
    expect(parseScene({ ...scene, objects: [cylinder] }).objects).toEqual([
      cylinder,
    ]);
    const short: Record<string, unknown> = { ...cylinder };
    delete short.length;
    expect(() => parseScene({ ...scene, objects: [short] })).toThrow("length");
  });

  it("applies a library material without changing the mass", () => {
    const ball = makeObject("ball", "ball-1") as Ball;
    const rubber = withMaterial(ball, "rubber");
    expect(rubber).toEqual({
      ...ball,
      material: "rubber",
      friction: MATERIALS.rubber.friction,
      restitution: MATERIALS.rubber.restitution,
    });
    expect(densityMass(ball, "steel")).toBeCloseTo(
      7850 * (4 / 3) * Math.PI * ball.radius ** 3,
      9,
    );
  });

  it("splits a launch into components to the millimetre per second", () => {
    expect(launchVelocity(10, 45)).toEqual({ vx: 7.071, vy: 7.071 });
    expect(launchVelocity(4, 90)).toEqual({ vx: 0, vy: 4 });
    const { speed, elevation } = launchOf({ vx: 3, vy: 4 });
    expect(speed).toBe(5);
    expect(elevation).toBeCloseTo(53.13010235, 8);
  });

  it("defaults a pulley's wheel to massless and checks a given wheel mass", () => {
    const scene = makeScene("pulley");
    const bare: Partial<Pulley> = { ...(scene.objects[0] as Pulley) };
    delete bare.wheelMass;
    expect(parseScene({ ...scene, objects: [bare] }).objects[0]).toEqual({
      ...bare,
      wheelMass: 0,
    });
    const heavy = { ...bare, wheelMass: 4 };
    expect(parseScene({ ...scene, objects: [heavy] }).objects[0]).toEqual(
      heavy,
    );
    expect(() =>
      parseScene({ ...scene, objects: [{ ...bare, wheelMass: 21 }] }),
    ).toThrow("wheelMass must be a number between 0 and 20.");
  });

  it("hangs an older pendulum on a massless rod and checks its link", () => {
    const base = makeScene("blank");
    const bare: Partial<Pendulum> = makeObject("pendulum", "pendulum-1");
    delete bare.link;
    delete bare.rodMass;
    expect(parseScene({ ...base, objects: [bare] }).objects[0]).toMatchObject({
      link: "rod",
      rodMass: 0,
    });
    const heavy = { ...bare, rodMass: 2 };
    expect(parseScene({ ...base, objects: [heavy] }).objects[0]).toMatchObject({
      link: "rod",
      rodMass: 2,
    });
    expect(() =>
      parseScene({ ...base, objects: [{ ...bare, link: "chain" }] }),
    ).toThrow("link must be one of rod, rope.");
    expect(() =>
      parseScene({ ...base, objects: [{ ...heavy, link: "rope" }] }),
    ).toThrow("A rope has no mass");
    expect(() =>
      parseScene({ ...base, objects: [{ ...bare, rodMass: 21 }] }),
    ).toThrow("rodMass must be a number between 0 and 20.");
  });

  it("rejects a pendulum or spring that would reach the floor or anchor", () => {
    const pendulum = makeObject("pendulum", "pendulum-1", 0, 0);
    const spring = makeObject("spring", "spring-1", 0, 0);
    const base = makeScene("blank");
    expect(() =>
      parseScene({
        ...base,
        objects: [{ ...pendulum, length: pendulum.pivotHeight }],
      }),
    ).toThrow("floor");
    expect(() =>
      parseScene({ ...base, objects: [{ ...spring, offset: 2.5 }] }),
    ).toThrow("anchor");
    expect(() =>
      parseScene({ ...base, objects: [{ ...spring, mass: 60 }] }),
    ).toThrow("floor");
    expect(
      parseScene({ ...base, objects: [pendulum, spring] }).objects,
    ).toHaveLength(2);
  });

  it("places additional blocks in free positions on a ramp", () => {
    const ramp = { ...makeObject("ramp", "ramp"), angle: 30, x: 2, z: -1 };
    const first = blockOnRamp(makeObject("block", "first"), ramp);
    const second = findRampPlacement(makeObject("block", "second"), ramp, [
      ramp,
      first,
    ]);
    expect(rampHeight(ramp)).toBeCloseTo(7 / Math.sqrt(3));
    expect(first.rotation).toBe(-30);
    expect(rampPlacement(first, ramp)?.fraction).toBeCloseTo(0.23);
    expect(second?.x).toBeGreaterThan(first.x);
    expect(second?.z).toBe(ramp.z);
    expect(rampPlacement({ ...first, y: first.y + 1 }, ramp)).toBeUndefined();
    expect(
      findRampPlacement({ ...first, size: 3 }, { ...ramp, width: 2 }, []),
    ).toBeUndefined();
  });

  it("places a body in contact with the ramp and still recognises the legacy gap", () => {
    const ramp = { ...makeObject("ramp", "ramp"), angle: 30, x: 2, z: -1 };
    const block = blockOnRamp(makeObject("block", "block"), ramp, 0.4);
    const tilt = Math.PI / 6;
    const surfaceX = ramp.length * (0.4 - 0.5);
    const surfaceY = (ramp.length / 2 - surfaceX) * Math.tan(tilt);
    const normalDistance =
      (block.x - ramp.x - surfaceX) * Math.sin(tilt) +
      (block.y - surfaceY) * Math.cos(tilt);
    expect(RAMP_CLEARANCE).toBe(0);
    expect(normalDistance).toBeCloseTo(block.size / 2, 12);

    const legacy = blockOnRamp(
      makeObject("block", "legacy"),
      ramp,
      0.4,
      0,
      LEGACY_RAMP_CLEARANCE,
    );
    expect(legacy.y).toBeGreaterThan(block.y);
    expect(rampPlacement(legacy, ramp)?.fraction).toBeCloseTo(0.4, 12);
    expect(rampPlacement(block, ramp)?.fraction).toBeCloseTo(0.4, 12);
    expect(
      rampPlacement({ ...block, y: block.y + 0.005 }, ramp),
    ).toBeUndefined();
  });
});
