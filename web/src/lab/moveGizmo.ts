import * as THREE from "three";
import { isBody, type LabObject } from "./scene";
import type { ViewportPalette } from "./viewportPalette";

/** A world axis a part can be moved along with its arrow. */
export type MoveAxis = "x" | "y" | "z";
export const MOVE_AXES: readonly MoveAxis[] = ["x", "y", "z"];

/** On-screen length of each arrow, in CSS pixels, whatever the zoom. */
export const ARROW_PIXELS = 104;
/** Below this many pixels per metre an axis points at the camera and cannot be dragged. */
export const MIN_AXIS_PIXELS = 6;

/**
 * The point the move arrows start from: a free body's centre, a pendulum's pivot, a
 * spring's anchor, and the base of a ramp, a pulley or a bumper. Its height is the field the y arrow
 * changes.
 */
export function gizmoOrigin(part: LabObject) {
  if (isBody(part)) return { x: part.x, y: part.y, z: part.z };
  if (part.kind === "pendulum")
    return { x: part.x, y: part.pivotHeight, z: part.z };
  if (part.kind === "spring")
    return { x: part.x, y: part.anchorHeight, z: part.z };
  return { x: part.x, y: 0, z: part.z };
}

/** Axes a part can move along: ramps, pulleys and bumpers stand on the floor. */
export const movableAxes = (part: LabObject): readonly MoveAxis[] =>
  part.kind === "ramp" || part.kind === "pulley" || part.kind === "bumper"
    ? ["x", "z"]
    : MOVE_AXES;

/**
 * Metres along an axis for a pointer movement. `axisPixels` is the on-screen image of one
 * metre along the axis and `delta` the pointer movement, both in CSS pixels with y down.
 * Only the component along the arrow counts. Returns undefined when the axis points at the
 * camera, where a small pointer movement would mean a large jump.
 */
export function axisOffset(
  axisPixels: { x: number; y: number },
  delta: { x: number; y: number },
): number | undefined {
  const length2 = axisPixels.x ** 2 + axisPixels.y ** 2;
  if (length2 < MIN_AXIS_PIXELS ** 2) return undefined;
  return (delta.x * axisPixels.x + delta.y * axisPixels.y) / length2;
}

/** Rounds a dragged offset to whole centimetres, so typed and dragged values agree. */
export const snapOffset = (metres: number) => Math.round(metres * 100) / 100;

const DIRECTION: Record<MoveAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export type MoveGizmo = {
  root: THREE.Group;
  /** Invisible, wider meshes the pointer hits, one per axis. */
  targets: THREE.Mesh[];
  /** Shows the arrows the part can use and highlights the hovered or dragged one. */
  show: (axes: readonly MoveAxis[], active?: MoveAxis) => void;
  /** Places the arrows at a world point and sizes them for `metresPerPixel`. */
  place: (origin: THREE.Vector3Like, metresPerPixel: number) => void;
  dispose: () => void;
};

/**
 * Three arrows drawn over the scene at the selected part. Each is a shaft and a cone along
 * +x, +y or +z in the axis colours, drawn without depth so a part never hides them.
 */
export function createMoveGizmo(palette: ViewportPalette): MoveGizmo {
  const root = new THREE.Group();
  root.name = "move-gizmo";
  root.renderOrder = 10;
  const colours: Record<MoveAxis, THREE.Color> = {
    x: new THREE.Color(palette.axisX),
    y: new THREE.Color(palette.axisY),
    z: new THREE.Color(palette.axisZ),
  };
  const white = new THREE.Color(palette.axisHover);
  const handles = new Map<
    MoveAxis,
    { group: THREE.Group; material: THREE.MeshBasicMaterial }
  >();
  const targets: THREE.Mesh[] = [];
  const shaft = new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10);
  shaft.translate(0, 0.39, 0);
  const head = new THREE.ConeGeometry(0.075, 0.22, 18);
  head.translate(0, 0.89, 0);
  const hit = new THREE.CylinderGeometry(0.13, 0.13, 1.08, 8);
  hit.translate(0, 0.54, 0);
  const hidden = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshBasicMaterial({
      color: palette.partEdge,
      depthTest: false,
      transparent: true,
    }),
  );
  hub.renderOrder = 11;
  root.add(hub);

  for (const axis of MOVE_AXES) {
    const material = new THREE.MeshBasicMaterial({
      color: colours[axis],
      depthTest: false,
      transparent: true,
    });
    const group = new THREE.Group();
    group.quaternion.setFromUnitVectors(DIRECTION.y, DIRECTION[axis]);
    const parts = [
      new THREE.Mesh(shaft, material),
      new THREE.Mesh(head, material),
    ];
    for (const part of parts) {
      part.renderOrder = 11;
      group.add(part);
    }
    const target = new THREE.Mesh(hit, hidden);
    target.userData.axis = axis;
    group.add(target);
    targets.push(target);
    root.add(group);
    handles.set(axis, { group, material });
  }
  root.visible = false;

  return {
    root,
    targets,
    show(axes, active) {
      for (const [axis, { group, material }] of handles) {
        group.visible = axes.includes(axis);
        material.color
          .copy(colours[axis])
          .lerp(white, active === axis ? 0.35 : 0);
        material.opacity = active && active !== axis ? 0.45 : 1;
      }
    },
    place(origin, metresPerPixel) {
      root.position.set(origin.x, origin.y, origin.z);
      root.scale.setScalar(ARROW_PIXELS * metresPerPixel);
    },
    dispose() {
      shaft.dispose();
      head.dispose();
      hit.dispose();
      hidden.dispose();
      hub.geometry.dispose();
      (hub.material as THREE.Material).dispose();
      handles.forEach(({ material }) => material.dispose());
    },
  };
}
