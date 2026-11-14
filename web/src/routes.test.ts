import { describe, expect, it } from "vitest";
import { presetNames } from "./lab/scene";
import {
  labHash,
  legacyRedirect,
  parseHash,
  parseLabQuery,
  type LabLocation,
} from "./routes";

const lab = (hash: string): LabLocation => {
  const { path, query } = parseHash(hash);
  expect(path).toBe("/lab");
  return parseLabQuery(query);
};

describe("shared lab links", () => {
  it("keeps a well-formed shared value for its own study", () => {
    expect(lab("/lab?study=motion&scene=ab_C-9")).toEqual({
      study: "motion",
      scene: "ab_C-9",
    });
    expect(lab("/lab?study=stress&case=xyz")).toEqual({
      study: "stress",
      case: "xyz",
    });
    expect(lab("/lab?study=motion&case=xyz")).toEqual({ study: "motion" });
    expect(lab("/lab?study=stress&scene=xyz")).toEqual({ study: "stress" });
  });

  it("drops malformed or oversized shared values", () => {
    expect(lab("/lab?study=stress&case=a%2Bb")).toEqual({ study: "stress" });
    expect(lab("/lab?study=stress&case=")).toEqual({ study: "stress" });
    expect(lab(`/lab?study=motion&scene=${"a".repeat(8193)}`)).toEqual({
      study: "motion",
    });
  });

  it("writes the shared value into the hash", () => {
    expect(labHash({ study: "stress", case: "abc" })).toBe(
      "/lab?study=stress&case=abc",
    );
    expect(labHash({ study: "motion", scene: "abc", case: "x" })).toBe(
      "/lab?study=motion&scene=abc",
    );
  });
});

describe("hash parsing", () => {
  it("splits the path from the query and trims trailing slashes", () => {
    expect(parseHash("").path).toBe("/");
    expect(parseHash("#/").path).toBe("/");
    expect(parseHash("#/lab/").path).toBe("/lab");
    const { path, query } = parseHash("#/lab?study=stress&example=bracket");
    expect(path).toBe("/lab");
    expect(query.get("example")).toBe("bracket");
  });

  it("reads the lab query and ignores unknown values", () => {
    expect(lab("/lab")).toEqual({ study: "motion" });
    expect(lab("/lab?study=motion&template=pulley")).toEqual({
      study: "motion",
      template: "pulley",
    });
    expect(lab("/lab?study=stress&example=bracket&sheet=model")).toEqual({
      study: "stress",
      example: "bracket",
      sheet: "model",
    });
    expect(lab("/lab?study=fluids&template=rocket")).toEqual({
      study: "motion",
    });
    expect(lab("/lab?study=stress&example=gear&sheet=bogus")).toEqual({
      study: "stress",
    });
    expect(lab("/lab?study=motion&example=plate&sheet=model")).toEqual({
      study: "motion",
    });
  });

  it("round-trips every lab state through its hash", () => {
    const states: LabLocation[] = [
      { study: "motion" },
      ...Object.keys(presetNames).map(
        (template) => ({ study: "motion", template }) as LabLocation,
      ),
      { study: "stress", example: "plate" },
      { study: "stress", example: "bracket", sheet: "optimize" },
      { study: "stress", sheet: "agent" },
    ];
    for (const state of states) expect(lab(labHash(state))).toEqual(state);
  });
});

describe("old routes", () => {
  it.each([
    ["/lab/incline", { study: "motion", template: "incline" }],
    ["/lab/friction", { study: "motion", template: "friction" }],
    ["/lab/pulley", { study: "motion", template: "pulley" }],
    ["/lab/blank", { study: "motion", template: "blank" }],
    ["/lab/unknown", { study: "motion" }],
    ["/stress", { study: "stress" }],
    ["/studio", { study: "stress" }],
    ["/studio/plate", { study: "stress", example: "plate" }],
    ["/studio/bracket", { study: "stress", example: "bracket" }],
    ["/studio/plate/verify", { study: "stress", example: "plate" }],
    [
      "/studio/plate/optimize",
      { study: "stress", example: "plate", sheet: "optimize" },
    ],
    [
      "/studio/bracket/optimize",
      { study: "stress", example: "bracket", sheet: "optimize" },
    ],
    ["/model", { study: "stress", sheet: "model" }],
  ] as const)("%s redirects into the lab", (path, expected) => {
    const target = legacyRedirect(parseHash(path).path);
    expect(target).not.toBeNull();
    expect(lab(target!)).toEqual(expected);
  });

  it("leaves current routes and home anchors alone", () => {
    for (const path of [
      "/",
      "/lab",
      "/experiments",
      "/how-it-works",
      "/stress-tools",
    ])
      expect(legacyRedirect(path)).toBeNull();
  });
});
