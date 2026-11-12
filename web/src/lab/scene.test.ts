import { describe, expect, it } from "vitest";
import {
  blockOnRamp,
  findRampPlacement,
  makeObject,
  makeScene,
  OBJECT_LIMIT,
  parseScene,
  rampHeight,
  rampPlacement,
  type Preset,
} from "./scene";

describe("mechanics scene contract", () => {
  it.each<Preset>(["incline", "friction", "projectile", "pulley", "blank"])(
    "round-trips %s",
    (preset) => {
      const scene = makeScene(preset);
      expect(parseScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    },
  );

  it("rejects unsupported versions, object types, duplicate IDs and out-of-range values", () => {
    const scene = makeScene("incline");
    expect(() => parseScene({ ...scene, version: "physix.lab/2" })).toThrow(
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
        objects: [{ ...scene.objects[0], kind: "spring" }],
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
