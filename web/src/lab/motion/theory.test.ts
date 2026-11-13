import { describe, expect, it } from "vitest";
import {
  blockOnRamp,
  makeObject,
  makeScene,
  radians,
  type LabScene,
  type Pulley,
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
    ["pulley", 3],
    ["rolling", 2],
    ["pendulum", 2],
    ["spring", 1],
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

  it("adds the wheel's inertia and both tensions to the Atwood references", async () => {
    const scene = makeScene("pulley");
    scene.objects = [{ ...(scene.objects[0] as Pulley), wheelMass: 2 }];
    const references = referencesFor(scene);
    expect(references.map(({ id }) => id)).toEqual([
      "pulley-1.atwood.a",
      "pulley-1.atwood.T",
      "pulley-1.atwood.T2",
      "pulley-1.atwood.t",
    ]);
    expect(byId(scene, "atwood.a").value).toBeCloseTo(9.81 / 6, 12);
    expect(byId(scene, "atwood.a").formula).toContain("M/2");
    const run = await runProtocol(scene, defaultProtocol(scene));
    for (const reference of references)
      expect(compare(reference, run).within, reference.id).toBe(true);
  });

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

  it("rolls a ball below the slip limit and slides it above", async () => {
    const rolling = makeScene("rolling");
    const tilt = radians(26);
    expect(byId(rolling, "rolling.a").value).toBeCloseTo(
      (5 / 7) * 9.81 * Math.sin(tilt),
      12,
    );
    // μ = 0.05 < (2/7) tan 26° ≈ 0.139, so the ball slips the whole way.
    const slick = {
      ...rolling,
      objects: rolling.objects.map((part) =>
        part.kind === "ramp" ? { ...part, friction: 0.05 } : part,
      ),
    };
    const slip = byId(slick, "rolling.a");
    expect(slip.formula).toBe("a = g (sin θ − μ cos θ)");
    expect(slip.value).toBeCloseTo(
      9.81 * (Math.sin(tilt) - 0.05 * Math.cos(tilt)),
      12,
    );
    const run = await runProtocol(slick, defaultProtocol(slick));
    expect(compare(slip, run).within, `Δ ${compare(slip, run).delta}`).toBe(
      true,
    );
  });

  it("gives the exact pendulum period at large angles and flags the small-angle one", async () => {
    const scene = makeScene("pendulum");
    const wide = {
      ...scene,
      objects: [{ ...makeObject("pendulum", "pendulum-1"), angle: 60 }],
    };
    const small = byId(wide, "pendulum.T0");
    const exact = byId(wide, "pendulum.T");
    expect(small.broken).toMatch("60°");
    // T / T₀ = (2/π) K(sin 30°) = 1.0732 for a 60° release.
    expect(exact.value / small.value).toBeCloseTo(1.0732, 4);
    const run = await runProtocol(wide, { stop: "time", maxTime: 10 });
    expect(compare(exact, run).within).toBe(true);
    expect(compare(small, run).within).toBe(false);
    expect(
      referencesFor({
        ...wide,
        objects: [{ ...wide.objects[0], angle: 0 }],
      }),
    ).toEqual([]);
  });

  it("predicts the damped spring period and flags overdamping", async () => {
    const scene = makeScene("spring");
    const damped = {
      ...scene,
      objects: [{ ...makeObject("spring", "spring-1"), damping: 4 }],
    };
    const period = byId(damped, "spring.T");
    const zeta = 4 / (2 * Math.sqrt(80 * 2));
    expect(period.value).toBeCloseTo(
      (2 * Math.PI) / (Math.sqrt(40) * Math.sqrt(1 - zeta * zeta)),
      12,
    );
    // ζ 0.16 and 0.40: the period is measured until the swing fades to 10⁻³ of the offset.
    for (const damping of [4, 10]) {
      const scenario = {
        ...scene,
        objects: [{ ...makeObject("spring", "spring-1"), damping }],
      };
      const run = await runProtocol(scenario, { stop: "time", maxTime: 10 });
      const { delta, within } = compare(byId(scenario, "spring.T"), run);
      expect(within, `c ${damping}: Δ ${delta}`).toBe(true);
      expect(Math.abs(delta ?? 1)).toBeLessThan(1e-3);
    }
    const heavy = {
      ...scene,
      objects: [{ ...makeObject("spring", "spring-1"), damping: 40 }],
    };
    expect(byId(heavy, "spring.T").broken).toMatch("ζ");
    expect(byId(heavy, "spring.T").value).toBe(Number.POSITIVE_INFINITY);
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
    const [swing] = curvesFor(makeScene("pendulum"));
    expect(swing.key).toBe("pendulum-1.angle");
    expect(swing.at(0)).toBeCloseTo(radians(8), 12);
    const [bounce] = curvesFor(makeScene("spring"));
    expect(bounce.key).toBe("spring-1.displacement");
    expect(bounce.at(0)).toBe(0.5);
    const roll = curvesFor(makeScene("rolling")).find(
      ({ key }) => key === "ball-1.speed",
    )!;
    expect(roll.at(1)).toBeCloseTo(
      byId(makeScene("rolling"), "rolling.a").value,
      12,
    );
  });
});
