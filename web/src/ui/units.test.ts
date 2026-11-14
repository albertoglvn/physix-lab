import { describe, expect, it } from "vitest";
import { asSentence } from "./units";

describe("asSentence", () => {
  it("capitalises a manifest note and ends it with a full stop", () => {
    expect(
      asSentence(
        "out-of-domain cases are always routed to the solver by the domain check",
      ),
    ).toBe(
      "Out-of-domain cases are always routed to the solver by the domain check.",
    );
  });

  it("keeps a note that is already a sentence", () => {
    expect(asSentence(" Checked with FEM. ")).toBe("Checked with FEM.");
    expect(asSentence("")).toBe("");
  });
});
