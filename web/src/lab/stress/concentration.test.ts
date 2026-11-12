import { describe, expect, it } from "vitest";
import { examplePlate, exampleBracket } from "../../physics/case";
import {
  heywoodGross,
  heywoodNet,
  KIRSCH_KT,
  ktReferences,
  measuredKt,
} from "./concentration";

describe("Heywood and Kirsch references", () => {
  it("matches the closed forms", () => {
    expect(heywoodNet(0)).toBe(KIRSCH_KT);
    expect(heywoodNet(0.3)).toBeCloseTo(2.343, 12);
    expect(heywoodGross(0.3)).toBeCloseTo(2.343 / 0.7, 12);
    expect(() => heywoodNet(1)).toThrow();
    expect(() => heywoodNet(-0.1)).toThrow();
  });

  it("applies to the canonical plate", () => {
    const ref = ktReferences(examplePlate());
    expect(ref.applicable).toBe(true);
    if (ref.applicable) {
      expect(ref.dOverH).toBeCloseTo(0.3, 12);
      expect(ref.heywoodGross).toBeCloseTo(3.347, 3);
    }
  });

  it("explains when the references do not apply", () => {
    const reason = (c = examplePlate()) => {
      const ref = ktReferences(c);
      return ref.applicable ? null : ref.reason;
    };
    expect(reason(exampleBracket())).toMatch(/plates/);
    const two = examplePlate();
    two.geometry.holes.push({ x: 0.16, y: 0.04, radius: 0.005 });
    expect(reason(two)).toMatch(/single hole/);
    const shear = examplePlate();
    shear.load = { kind: "traction", x: 10e6, y: 2e6 };
    expect(reason(shear)).toMatch(/axial/);
    const off = examplePlate();
    off.geometry.holes[0].y = 0.03;
    expect(reason(off)).toMatch(/centred/);
    const end = examplePlate();
    end.geometry.holes[0].x = 0.05;
    expect(reason(end)).toMatch(/end/);
    const big = examplePlate();
    big.geometry.holes[0].radius = 0.026;
    expect(reason(big)).toMatch(/0\.6/);
  });
});

describe("measured Kt", () => {
  it("uses the applied traction and the net section", () => {
    const kt = measuredKt(examplePlate(), 33.9e6)!;
    expect(kt.gross).toBeCloseTo(3.39, 12);
    expect(kt.net).toBeCloseTo(3.39 * 0.7, 12);
    expect(measuredKt(exampleBracket(), 1e6)!.net).toBeNull();
  });

  it("is undefined without a load", () => {
    const c = examplePlate();
    c.load = { kind: "traction", x: 0, y: 0 };
    expect(measuredKt(c, 1e6)).toBeNull();
  });
});
