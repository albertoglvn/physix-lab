import { describe, expect, it } from "vitest";
import { ropePoints } from "./LabViewport";

const length = (points: { x: number; y: number }[]) =>
  points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - points[index].x, point.y - points[index].y),
      0,
    );

describe("pendulum rope", () => {
  it("runs straight when taut and sags to about its length when slack", () => {
    const taut = ropePoints({ x: 0, y: 5 }, { x: 0, y: 2 }, 3);
    expect(taut.every((point) => point.x === 0)).toBe(true);
    expect(length(taut)).toBeCloseTo(3, 12);
    const slack = ropePoints({ x: 0, y: 5 }, { x: 2, y: 5 }, 2.2);
    expect(slack[0]).toEqual({ x: 0, y: 5 });
    expect(slack[slack.length - 1]).toEqual({ x: 2, y: 5 });
    expect(Math.min(...slack.map((point) => point.y))).toBeLessThan(5);
    expect(length(slack) / 2.2).toBeCloseTo(1, 1);
  });
});
