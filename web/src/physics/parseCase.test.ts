import { describe, expect, it } from "vitest";
import { exampleBracket, examplePlate } from "./case";
import { CaseParseError, MAX_HOLES, parseCase } from "./parseCase";

type Raw = Record<string, unknown>;
const plate = () => JSON.parse(JSON.stringify(examplePlate())) as Raw;

function field(input: unknown): string | undefined {
  try {
    parseCase(input);
  } catch (error) {
    expect(error).toBeInstanceOf(CaseParseError);
    return (error as CaseParseError).field;
  }
  throw new Error("expected the case to be rejected");
}

describe("parseCase", () => {
  it("accepts the canonical plate and bracket unchanged", () => {
    expect(parseCase(examplePlate())).toEqual(examplePlate());
    expect(parseCase(exampleBracket())).toEqual(exampleBracket());
  });

  it("fills defaults and drops fields the lab does not use", () => {
    const raw = plate();
    delete raw.support;
    (raw.load as Raw).kind = undefined;
    raw.meta = { note: "x" };
    (raw.geometry as Raw).web_width = 0.05;
    const parsed = parseCase(raw);
    expect(parsed.support).toBe("clamped");
    expect(parsed.load.kind).toBe("traction");
    expect(parsed).not.toHaveProperty("meta");
    expect(parsed.geometry).not.toHaveProperty("web_width");
  });

  it("rejects malformed structure", () => {
    expect(field(null)).toBe("case");
    expect(field([])).toBe("case");
    expect(field({ ...plate(), schema: "physix.case/2" })).toBe("schema");
    expect(field({ ...plate(), family: "shell" })).toBe("family");
    expect(field({ ...plate(), geometry: 1 })).toBe("geometry");
    expect(field({ ...plate(), thickness: "5" })).toBe("thickness");
    expect(field({ ...plate(), thickness: null })).toBe("thickness");
    expect(field({ ...plate(), support: "roller" })).toBe("support");
    expect(field({ ...plate(), load: { kind: "moment", x: 1, y: 0 } })).toBe(
      "load.kind",
    );
    const bracket = JSON.parse(JSON.stringify(exampleBracket())) as Raw;
    delete (bracket.geometry as Raw).fillet_radius;
    expect(field(bracket)).toBe("geometry.fillet_radius");
    const holes = plate();
    (holes.geometry as Raw).holes = Array.from(
      { length: MAX_HOLES + 1 },
      () => ({
        x: 0.1,
        y: 0.04,
        radius: 0.001,
      }),
    );
    expect(field(holes)).toBe("geometry.holes");
    const hole = plate();
    (hole.geometry as Raw).holes = [{ x: 0.1, y: 0.04 }];
    expect(field(hole)).toBe("geometry.holes[0].radius");
  });

  it("applies the solver's numeric limits", () => {
    const g = (geometry: Raw) => ({
      ...plate(),
      geometry: { ...(plate().geometry as Raw), ...geometry },
    });
    expect(field(g({ width: 20 }))).toBe("geometry.width");
    expect(field(g({ height: 0.5 }))).toBe("geometry.height");
    expect(field({ ...plate(), thickness: 0.03 })).toBe("thickness");
    expect(
      field({ ...plate(), material: { name: "x", young: 1e3, poisson: 0.3 } }),
    ).toBe("material.young");
    expect(
      field({ ...plate(), material: { name: "x", young: 1e9, poisson: 0.5 } }),
    ).toBe("material.poisson");
    expect(field({ ...plate(), load: { kind: "traction", x: 0, y: 0 } })).toBe(
      "load",
    );
    expect(
      field({ ...plate(), load: { kind: "traction", x: 2e11, y: 0 } }),
    ).toBe("load");
    expect(
      field({ ...plate(), load: { kind: "traction", x: Infinity, y: 0 } }),
    ).toBe("load.x");
  });

  it("applies the geometry checks", () => {
    const raw = plate();
    (raw.geometry as Raw).holes = [{ x: 0.1, y: 0.04, radius: 0.05 }];
    expect(field(raw)).toBe("geometry.holes[0]");
  });
});
