import { describe, expect, it } from "vitest";
import { makeObject, makeScene } from "../scene";
import { measure, summarize, type Reading } from "./measurements";

describe("motion measurements", () => {
  it("reports time and gravity when no part is selected", () => {
    const scene = makeScene("incline");
    const readings = measure(scene, undefined, undefined, 0.5);
    expect(readings.map((r) => r.short)).toEqual(["t", "g"]);
    expect(readings[1].value).toBe(scene.gravity);
    expect(readings[1].unit).toBe("m/s²");
  });

  it("reports speed and position for a block before the run starts", () => {
    const scene = makeScene("blank");
    const block = makeObject("block", "block-1");
    const readings = measure(scene, block, undefined, 0);
    expect(readings.map((r) => r.short)).toEqual(["t", "v", "h", "x"]);
    expect(readings[1].value).toBe(0);
    expect(readings[2].unit).toBe("m");
  });

  it("summarizes the first three readings with two decimals", () => {
    const readings: Reading[] = [
      { label: "Time", short: "t", value: 1.416, unit: "s" },
      { label: "Speed", short: "v", value: 3.181, unit: "m/s" },
      { label: "Height", short: "h", value: 0.5249, unit: "m" },
      { label: "X position", short: "x", value: 9, unit: "m" },
    ];
    expect(summarize(readings)).toBe("t 1.42 s · v 3.18 m/s · h 0.52 m");
  });

  it("shows a dash for a value that is not finite", () => {
    expect(
      summarize([
        { label: "Tension", short: "T", value: Number.NaN, unit: "N" },
      ]),
    ).toBe("T — N");
  });
});
