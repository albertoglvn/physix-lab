import { describe, expect, it } from "vitest";
import {
  ARROW_PIXELS,
  axisOffset,
  createMoveGizmo,
  gizmoOrigin,
  MIN_AXIS_PIXELS,
  movableAxes,
  snapOffset,
} from "./moveGizmo";
import { makeObject } from "./scene";
import { readViewportPalette, VIEWPORT_TOKENS } from "./viewportPalette";

describe("gizmoOrigin", () => {
  it("starts at a free body's centre", () => {
    const block = { ...makeObject("block", "b", 1.5, -2), y: 0.8 };
    expect(gizmoOrigin(block)).toEqual({ x: 1.5, y: 0.8, z: -2 });
  });

  it("starts at a pendulum's pivot and a spring's anchor", () => {
    const pendulum = makeObject("pendulum", "p", 2, 1);
    expect(gizmoOrigin(pendulum)).toEqual({
      x: 2,
      y: pendulum.pivotHeight,
      z: 1,
    });
    const spring = makeObject("spring", "s", -1, 0.5);
    expect(gizmoOrigin(spring)).toEqual({
      x: -1,
      y: spring.anchorHeight,
      z: 0.5,
    });
  });

  it("starts on the floor under a ramp or a pulley", () => {
    expect(gizmoOrigin(makeObject("ramp", "r", 3, 4))).toEqual({
      x: 3,
      y: 0,
      z: 4,
    });
    expect(gizmoOrigin(makeObject("pulley", "w", -3, 0))).toEqual({
      x: -3,
      y: 0,
      z: 0,
    });
  });
});

describe("movableAxes", () => {
  it("keeps ramps and pulleys on the floor", () => {
    expect(movableAxes(makeObject("ramp", "r"))).toEqual(["x", "z"]);
    expect(movableAxes(makeObject("pulley", "w"))).toEqual(["x", "z"]);
    expect(movableAxes(makeObject("bumper", "b"))).toEqual(["x", "z"]);
  });

  it("lets bodies, pendulums and springs move on all three axes", () => {
    for (const kind of [
      "block",
      "ball",
      "cylinder",
      "pendulum",
      "spring",
    ] as const)
      expect(movableAxes(makeObject(kind, kind))).toEqual(["x", "y", "z"]);
  });
});

describe("axisOffset", () => {
  it("counts only the pointer movement along the arrow", () => {
    // One metre spans 50 px to the right on screen.
    expect(axisOffset({ x: 50, y: 0 }, { x: 100, y: 0 })).toBe(2);
    expect(axisOffset({ x: 50, y: 0 }, { x: 100, y: 80 })).toBe(2);
    expect(axisOffset({ x: 50, y: 0 }, { x: -25, y: 0 })).toBe(-0.5);
  });

  it("follows an arrow that points up the screen", () => {
    // Screen y grows downward, so dragging up moves along +y.
    expect(axisOffset({ x: 0, y: -40 }, { x: 0, y: -60 })).toBe(1.5);
  });

  it("refuses an axis that points at the camera", () => {
    const short = MIN_AXIS_PIXELS - 1;
    expect(axisOffset({ x: short, y: 0 }, { x: 40, y: 0 })).toBeUndefined();
    expect(axisOffset({ x: 0, y: 0 }, { x: 40, y: 0 })).toBeUndefined();
  });
});

describe("snapOffset", () => {
  it("rounds to whole centimetres", () => {
    expect(snapOffset(1.234)).toBe(1.23);
    expect(snapOffset(-0.006)).toBe(-0.01);
    expect(snapOffset(0.5)).toBe(0.5);
  });
});

describe("createMoveGizmo", () => {
  const palette = readViewportPalette(() => "#808080");

  it("reads its colours from the viewport palette", () => {
    expect(VIEWPORT_TOKENS.axisX).toBe("--px-axis-x");
    expect(VIEWPORT_TOKENS.axisY).toBe("--px-axis-y");
    expect(VIEWPORT_TOKENS.axisZ).toBe("--px-axis-z");
  });

  it("starts hidden with one pointer target per axis", () => {
    const gizmo = createMoveGizmo(palette);
    expect(gizmo.root.visible).toBe(false);
    expect(gizmo.targets.map((target) => target.userData.axis)).toEqual([
      "x",
      "y",
      "z",
    ]);
    gizmo.dispose();
  });

  it("shows only the axes a part can use", () => {
    const gizmo = createMoveGizmo(palette);
    gizmo.show(["x", "z"]);
    const shown = gizmo.targets.map((target) => target.parent?.visible);
    expect(shown).toEqual([true, false, true]);
    gizmo.dispose();
  });

  it("keeps a constant on-screen size", () => {
    const gizmo = createMoveGizmo(palette);
    gizmo.place({ x: 1, y: 2, z: 3 }, 0.01);
    expect(gizmo.root.position.toArray()).toEqual([1, 2, 3]);
    expect(gizmo.root.scale.x).toBeCloseTo(ARROW_PIXELS * 0.01);
    gizmo.dispose();
  });
});
