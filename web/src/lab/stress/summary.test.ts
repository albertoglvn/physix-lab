import { describe, expect, it } from "vitest";
import { stressSummary } from "./summary";

describe("stress dock summary", () => {
  it("reads peak, safety, concentration, spread and source in display units", () => {
    expect(
      stressSummary({
        peak: 123.4e6,
        safety: 2.026,
        kt: 2.5,
        disagreement: 0.031,
        source: "surrogate",
      }),
    ).toBe("peak 123 MPa · SF 2.03 · Kt 2.50 · spread 3.1% · surrogate");
  });

  it("shows a dash for each missing value", () => {
    expect(
      stressSummary({ safety: null, kt: null, source: "no prediction" }),
    ).toBe("peak — · SF — · Kt — · spread — · no prediction");
  });
});
