import { describe, expect, it } from "vitest";
import fixture from "../../../../tests/fixtures/line_probe_v1.json";
import type { MeshPayload } from "../../api/client";
import type { Case } from "../../physics/case";
import { examplePlate, resultantForce } from "../../physics/case";
import {
  CONTAINMENT_TOL,
  meshField,
  meshSampler,
  probeProfile,
  SECTION_SAMPLES,
  sectionResultant,
  type Point,
  type ProbeComponent,
} from "./probe";

const KEYS: Record<string, ProbeComponent> = {
  sxx: "sxx",
  syy: "syy",
  txy: "txy",
  von_mises: "vonMises",
};

describe("the line probe matches FEM point evaluation (line_probe_v1)", () => {
  const field = meshField({
    ...fixture.mesh,
    von_mises: "",
  } as MeshPayload);
  const sampler = meshSampler(field!);
  const c = fixture.case as Case;

  it("uses the same case, containment rule and mesh size", () => {
    expect(c).toEqual(examplePlate());
    expect(fixture.containment_tolerance).toBe(CONTAINMENT_TOL);
    expect(field!.triangles.length / 3).toBe(fixture.mesh.n_triangles);
    expect(field!.points.length / 2).toBe(fixture.mesh.n_nodes);
  });

  for (const probe of fixture.probes) {
    it(`reproduces the ${probe.name} profile`, () => {
      const line = { a: probe.a as Point, b: probe.b as Point };
      const profile = probeProfile(sampler, line, "fem", probe.n);
      const peak = Math.max(
        ...probe.values.von_mises.filter((v): v is number => v != null),
      );
      const tol = fixture.tolerance.value_rel_peak * peak;
      for (const [key, stored] of Object.entries(probe.values)) {
        const ours = profile[KEYS[key]];
        stored.forEach((expected, k) => {
          if (expected == null) expect(ours[k]).toBeNaN();
          else expect(Math.abs(ours[k] - expected)).toBeLessThanOrEqual(tol);
        });
      }
    });

    it(`integrates the same ${probe.name} section resultant`, () => {
      const line = { a: probe.a as Point, b: probe.b as Point };
      const [fx, fy] = sectionResultant(
        c,
        probeProfile(sampler, line, "fem", SECTION_SAMPLES),
      );
      const [ex, ey] = probe.section_resultant;
      const scale = Math.hypot(...fixture.applied_force);
      expect(Math.abs(fx - ex)).toBeLessThan(
        fixture.tolerance.force_rel * scale,
      );
      expect(Math.abs(fy - ey)).toBeLessThan(
        fixture.tolerance.force_rel * scale,
      );
    });
  }

  it("balances the applied force across the net section", () => {
    const net = fixture.probes.find((p) => p.name === "net_section")!;
    const [applied] = resultantForce(c);
    expect(net.section_resultant[0]).toBeCloseTo(applied, -2);
    expect(Math.abs(net.section_resultant[0] - applied) / applied).toBeLessThan(
      0.01,
    );
  });

  it("returns no field for a payload without element stress", () => {
    const { stress: _omit, ...rest } = fixture.mesh;
    void _omit;
    expect(meshField({ ...rest, von_mises: "" } as MeshPayload)).toBeNull();
  });
});
