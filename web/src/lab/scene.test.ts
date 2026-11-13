import { describe, expect, it } from "vitest";
import {
  blockOnRamp,
  densityMass,
  findRampPlacement,
  launchOf,
  launchVelocity,
  makeObject,
  MATERIALS,
  makeScene,
  OBJECT_LIMIT,
  parseScene,
  rampHeight,
  rampPlacement,
  SCENE_VERSION,
  withMaterial,
  type Ball,
  type Preset,
  type Pulley,
} from "./scene";

describe("mechanics scene contract", () => {
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
});
