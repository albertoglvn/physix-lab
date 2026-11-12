import { describe, expect, it } from "vitest";
import {
  blockOnRamp,
  makeObject,
  makeScene,
  radians,
  type LabScene,
  type Preset,
} from "../scene";
import { defaultProtocol } from "./probes";
import { runProtocol } from "./run";
import { compare, curvesFor, referencesFor, type Reference } from "./theory";

const byId = (scene: LabScene, suffix: string) => {
  const reference = referencesFor(scene).find(({ id }) => id.endsWith(suffix));
  if (!reference) throw new Error(`No ${suffix} reference.`);
  return reference;
};

describe("closed-form references", () => {
  it("evaluates each template's formula", () => {
    const g = 9.81;
    const incline = makeScene("incline");
    const tilt = radians(26);
    expect(byId(incline, "incline.a").value).toBeCloseTo(
      g * (Math.sin(tilt) - 0.2 * Math.cos(tilt)),
      12,
    );
    const friction = makeScene("friction");
    expect(byId(friction, "friction.d").value).toBeCloseTo(
      25 / (2 * 0.35 * g),
      12,
    );
    expect(byId(friction, "friction.t").value).toBeCloseTo(5 / (0.35 * g), 12);
    const projectile = makeScene("projectile");
    const fall = Math.sqrt((2 * 5.5) / g);
    expect(byId(projectile, "projectile.t").value).toBeCloseTo(fall, 12);
    expect(byId(projectile, "projectile.r").value).toBeCloseTo(4 * fall, 12);
    const pulley = makeScene("pulley");
    expect(byId(pulley, "atwood.a").value).toBeCloseTo(g / 5, 12);
    expect(byId(pulley, "atwood.T").value).toBeCloseTo((12 * g) / 5, 12);
    expect(referencesFor(makeScene("blank"))).toEqual([]);
  });

  it.each<[Preset, number]>([
    ["incline", 2],
    ["friction", 2],
    ["projectile", 2],
    ["pulley", 2],
  ])(
    "matches the %s template within tolerance at the default step",
    async (preset, count) => {
      const scene = makeScene(preset);
      const run = await runProtocol(scene, defaultProtocol(scene));
      const references = referencesFor(scene);
      expect(references).toHaveLength(count);
      for (const reference of references) {
        expect(reference.broken).toBeUndefined();
        const comparison = compare(reference, run);
        expect(comparison.measured, reference.id).toBeDefined();
        expect(comparison.within, `${reference.id} Δ ${comparison.delta}`).toBe(
          true,
        );
      }
    },
  );

  it("predicts no motion when the ramp holds the block", async () => {
    const scene = makeScene("incline");
    scene.objects = scene.objects.map((part) =>
      part.kind === "ramp" ? { ...part, friction: 0.95 } : part,
    );
    const references = referencesFor(scene);
    expect(references.map(({ id }) => id)).toEqual(["block-1.incline.a"]);
    const [reference] = references;
    expect(reference.value).toBe(0);
    expect(reference.formula).toMatch("tan θ ≤ μ");
    const run = await runProtocol(scene, { stop: "time", maxTime: 2 });
    const comparison = compare(reference, run);
    expect(comparison.relative).toBe(false);
    expect(comparison.within).toBe(true);
  });

  it("flags scenes that leave a reference's assumptions", () => {
    const incline = makeScene("incline");
    const ramp = incline.objects.find((part) => part.kind === "ramp")!;
    if (ramp.kind !== "ramp") throw new Error("The template needs a ramp.");
    incline.objects.push(
      blockOnRamp(makeObject("block", "block-2"), ramp, 0.6),
    );
    expect(byId(incline, "block-1.incline.a").broken).toMatch("block-2");

    const smooth = { ...makeScene("friction"), floorFriction: 0 };
    expect(byId(smooth, "friction.d").broken).toMatch("never stops");

    const blocked = makeScene("friction");
    blocked.objects.push({ ...makeObject("block", "wall", -1), y: 0.5 });
    expect(byId(blocked, "block-1.friction.d").broken).toMatch("wall");

    const covered = makeScene("projectile");
    covered.objects.push(makeObject("ramp", "ramp-1", -3));
    expect(byId(covered, "projectile.t").broken).toMatch("ramp-1");
  });

  it("compares relatively above the floor and absolutely below it", () => {
    const reference: Reference = {
      id: "test",
      target: "block-1",
      label: "Test",
      symbol: "q",
      unit: "m",
      formula: "q",
      value: 2,
      assumptions: [],
      tolerance: 0.01,
      floor: 0.05,
      measure: () => 2.03,
    };
    const fake = {} as Parameters<typeof compare>[1];
    expect(compare(reference)).toEqual({ reference, relative: true });
    expect(compare(reference, fake)).toMatchObject({
      measured: 2.03,
      relative: true,
      within: false,
    });
    expect(compare(reference, fake).delta).toBeCloseTo(0.015, 12);
    const near = { ...reference, value: 0, measure: () => 0.03 };
    expect(compare(near, fake)).toMatchObject({
      delta: 0.03,
      relative: false,
      within: true,
    });
    const missing = { ...reference, measure: () => undefined };
    expect(compare(missing, fake).within).toBeUndefined();
  });

  it("draws theory curves that start at the initial state", () => {
    const projectile = makeScene("projectile");
    const curves = curvesFor(projectile);
    const height = curves.find(({ key }) => key === "block-1.y")!;
    expect(height.at(0)).toBe(6);
    expect(height.until).toBeCloseTo(
      byId(projectile, "projectile.t").value,
      12,
    );
    const friction = curvesFor(makeScene("friction")).find(
      ({ key }) => key === "block-1.speed",
    )!;
    expect(friction.at(0)).toBe(5);
    expect(friction.at(100)).toBe(0);
    const pulley = curvesFor(makeScene("pulley"));
    expect(pulley.map(({ key }) => key)).toEqual([
      "pulley-1.speed",
      "pulley-1.displacement",
    ]);
  });
});
