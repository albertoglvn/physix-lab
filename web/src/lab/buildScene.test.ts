import { describe, expect, it } from "vitest";
import {
  buildScene,
  motionDomain,
  PART_FIELDS,
  SceneRequestError,
  sceneRequestSchema,
} from "./buildScene";
import { makeObject, makeScene, MATERIALS, type LabObject } from "./scene";

function rejects(input: unknown): SceneRequestError {
  try {
    buildScene(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SceneRequestError);
    return error as SceneRequestError;
  }
  throw new Error("expected the request to be rejected");
}

const KINDS: LabObject["kind"][] = [
  "block",
  "ball",
  "cylinder",
  "ramp",
  "pulley",
  "pendulum",
  "spring",
];

describe("buildScene", () => {
  it("returns a template unchanged, or with scene-wide changes", () => {
    expect(buildScene({ template: "pulley" }).scene).toEqual(
      makeScene("pulley"),
    );
    expect(buildScene(undefined).scene).toEqual(makeScene("blank"));
    const moon = buildScene({ template: "pendulum", gravity: 1.62 });
    expect(moon.scene.gravity).toBe(1.62);
    expect(moon.scene.objects).toEqual(makeScene("pendulum").objects);
    expect(moon.defaults).toEqual({});
  });

  it("matches the incline template when built from parts", () => {
    const built = buildScene({
      name: "Inclined plane",
      objects: [
        { kind: "ramp" },
        { kind: "block", on_ramp: { ramp: "ramp-1" } },
      ],
    });
    expect(built.scene).toEqual(makeScene("incline"));
    expect(built.defaults["ramp-1"]).toEqual([
      "x",
      "z",
      "length",
      "width",
      "angle",
      "friction",
    ]);
  });

  it("sets given values and lists the defaults it used", () => {
    const { scene, defaults } = buildScene({
      airDensity: 1.2,
      objects: [
        { kind: "ball", id: "drop", y: 20, radius: 0.1, mass: 0.2 },
        { kind: "pulley", leftMass: 3, rightMass: 5, wheelMass: 1 },
      ],
    });
    expect(scene.airDensity).toBe(1.2);
    expect(scene.objects[0]).toMatchObject({ id: "drop", y: 20, mass: 0.2 });
    expect(scene.objects[1].id).toBe("pulley-1");
    expect(defaults.drop).toEqual(["x", "z", "vx", "vy", "restitution"]);
    expect(defaults["pulley-1"]).toEqual(["x", "z"]);
  });

  it("reads launches, materials, forces and rope pendulums", () => {
    const { scene } = buildScene({
      objects: [
        {
          kind: "ball",
          y: 0.2,
          radius: 0.2,
          material: "rubber",
          friction: 0.6,
          launch: { speed: 10, elevation: 30 },
        },
        { kind: "block", y: 0.5, force: { x: 20, y: 0, start: 0, end: 2 } },
        { kind: "pendulum", link: "rope", angle: 60 },
      ],
    });
    const [ball, block, pendulum] = scene.objects;
    expect(ball).toMatchObject({
      material: "rubber",
      friction: 0.6,
      restitution: MATERIALS.rubber.restitution,
      vx: 8.66,
      vy: 5,
    });
    expect(block).toMatchObject({ force: { x: 20, y: 0, start: 0, end: 2 } });
    expect(pendulum).toMatchObject({ link: "rope", rodMass: 0, angle: 60 });
  });

  it("names the field of each rejected request", () => {
    expect(rejects([]).field).toBe("request");
    expect(rejects({ colour: 1 }).field).toBe("request.colour");
    expect(rejects({ template: "x" }).field).toBe("template");
    expect(rejects({ gravity: Infinity }).field).toBe("gravity");
    expect(rejects({ objects: {} }).field).toBe("objects");
    expect(rejects({ objects: [{ kind: "ramp", mass: 1 }] }).field).toBe(
      "objects[0].mass",
    );
    expect(rejects({ objects: [{ kind: "ball", radius: 9 }] }).field).toBe(
      "objects[0].radius",
    );
    expect(
      rejects({ objects: [{ kind: "ball" }, { kind: "ball", id: "ball-1" }] })
        .field,
    ).toBe("objects[1].id");
    expect(
      rejects({ objects: [{ kind: "ball", material: "gold" }] }).field,
    ).toBe("objects[0].material");
    expect(
      rejects({
        objects: [{ kind: "ball", vx: 1, launch: { speed: 1, elevation: 0 } }],
      }).field,
    ).toBe("objects[0].launch");
    expect(
      rejects({ objects: [{ kind: "pendulum", pivotHeight: 2, length: 3 }] })
        .message,
    ).toMatch(/floor/);
    expect(rejects({ name: "" }).message).toMatch(/name/);
  });

  it("checks placements on ramps", () => {
    const ramp = { kind: "ramp", width: 1 };
    expect(
      rejects({
        objects: [ramp, { kind: "block", x: 1, on_ramp: { ramp: "ramp-1" } }],
      }).field,
    ).toBe("objects[1].x");
    expect(
      rejects({
        objects: [
          ramp,
          { kind: "ball", on_ramp: { ramp: "ramp-1", fraction: 0.99 } },
        ],
      }).field,
    ).toBe("objects[1].on_ramp.fraction");
    expect(
      rejects({
        objects: [
          ramp,
          { kind: "cylinder", length: 2, on_ramp: { ramp: "ramp-1" } },
        ],
      }).field,
    ).toBe("objects[1].on_ramp");
    expect(
      rejects({ objects: [{ kind: "block", on_ramp: { ramp: "nope" } }] })
        .field,
    ).toBe("objects[0].on_ramp.ramp");
  });
});

describe("motion domain and request schema", () => {
  it("describes every numeric field of every part with its default", () => {
    const domain = motionDomain();
    for (const kind of KINDS) {
      const part = makeObject(kind, "p") as unknown as Record<string, unknown>;
      const numeric = Object.keys(part).filter(
        (key) => typeof part[key] === "number",
      );
      const surface = ["block", "ball", "cylinder"].includes(kind)
        ? ["friction", "dragCoefficient"]
        : [];
      const fields = domain.parts[kind] as Record<string, { default?: number }>;
      expect(Object.keys(fields).sort(), kind).toEqual(
        [...numeric, ...surface].sort(),
      );
      for (const key of numeric)
        expect(fields[key].default, `${kind}.${key}`).toBe(part[key]);
    }
  });

  it("offers every field the builder accepts in the tool schema", () => {
    const schema = sceneRequestSchema();
    const props = schema.properties.objects.items.properties;
    for (const fields of Object.values(PART_FIELDS))
      for (const key of Object.keys(fields)) expect(props).toHaveProperty(key);
    expect(props.kind.enum).toEqual(KINDS);
    expect(Object.keys(schema.properties)).toContain("airDensity");
  });
});
