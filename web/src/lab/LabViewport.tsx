import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  BUMPER_DEPTH,
  BUMPER_HEIGHT,
  BUMPER_WALL,
  bumperDirection,
  isBody,
  movePart,
} from "./scene";
import {
  axisOffset,
  createMoveGizmo,
  gizmoOrigin,
  movableAxes,
  snapOffset,
  type MoveAxis,
} from "./moveGizmo";
import type {
  Ball,
  Body,
  Bumper,
  Cylinder,
  LabObject,
  LabScene,
  PartMove,
  Pendulum,
  Pulley,
  Spring,
} from "./scene";
import {
  documentViewportPalette,
  type ViewportPalette,
} from "./viewportPalette";
import {
  initialBlockState,
  PULLEY_BASE_HEIGHT,
  PULLEY_HEIGHT,
  PULLEY_RADIUS,
  PULLEY_WEIGHT_HEIGHT,
  PULLEY_WEIGHT_TALL,
  PULLEY_WEIGHT_WIDTH,
  rampVertices,
  type Simulation,
} from "./simulation";

/**
 * An arrow from the body's centre along its applied force, shown until the force ends.
 * Its length grows with the force, from 0.5 m to 2.5 m at 200 N.
 */
function forceArrow(
  object: Body,
  palette: ViewportPalette,
  current: () => Simulation | undefined,
) {
  const force = object.force!;
  const magnitude = Math.hypot(force.x, force.y);
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(force.x, force.y, 0).normalize(),
    new THREE.Vector3(),
    0.5 + 2 * Math.min(1, magnitude / 200),
    new THREE.Color(palette.weightRight),
    0.28,
    0.18,
  );
  arrow.visible = magnitude > 0;
  const update = () => {
    const time = current()?.time ?? 0;
    const position = current()?.block(object.id)?.position ?? object;
    arrow.position.set(position.x, position.y, position.z);
    arrow.visible = magnitude > 0 && time < force.end;
  };
  return { arrow, update };
}

type Drawable = {
  root: THREE.Object3D;
  outline: THREE.LineSegments;
  arrow?: THREE.ArrowHelper;
  base?: THREE.Vector3;
  update?: () => void;
};
type ViewOptions = {
  active: boolean;
  running: boolean;
  editable: boolean;
  axis: "plane" | "height";
  simulation?: Simulation;
};
type View = {
  mount: (scene: LabScene) => void;
  update: (options: ViewOptions) => void;
  select: (id: string | null) => void;
  reset: () => void;
  dispose: () => void;
};

function solid(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function edges(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 24),
    new THREE.LineBasicMaterial({ color }),
  );
}

function pulleyMesh(
  object: Pulley,
  palette: ViewportPalette,
  simulation: () => Simulation | undefined,
): THREE.Group {
  const root = new THREE.Group();
  const frame = palette.frame;
  const feet = solid(new THREE.BoxGeometry(2.05, 0.16, 1.18), frame);
  const upright = solid(
    new THREE.BoxGeometry(0.15, PULLEY_HEIGHT, 0.15),
    frame,
  );
  const arm = solid(new THREE.BoxGeometry(0.16, 0.17, 0.77), frame);
  feet.position.y = 0.08;
  upright.position.set(0, PULLEY_HEIGHT / 2, -0.46);
  arm.position.set(0, PULLEY_HEIGHT, -0.12);
  root.add(feet, upright, arm);

  const wheel = new THREE.Group();
  const disk = solid(
    new THREE.CylinderGeometry(PULLEY_RADIUS, PULLEY_RADIUS, 0.18, 32),
    palette.wheel,
  );
  disk.rotation.x = Math.PI / 2;
  const rim = solid(
    new THREE.TorusGeometry(PULLEY_RADIUS, 0.037, 8, 32),
    palette.rim,
  );
  const hub = solid(new THREE.SphereGeometry(0.12, 16, 12), palette.hub);
  hub.position.z = 0.12;
  wheel.position.y = PULLEY_HEIGHT;
  wheel.add(disk, rim, hub);
  for (let i = 0; i < 5; i++) {
    const spoke = solid(
      new THREE.BoxGeometry(0.035, 0.34, 0.022),
      palette.spoke,
    );
    const pivot = new THREE.Group();
    spoke.position.set(0, 0.29, 0.103);
    pivot.rotation.z = (i * Math.PI * 2) / 5;
    pivot.add(spoke);
    wheel.add(pivot);
  }
  root.add(wheel);

  const weightHeight = PULLEY_WEIGHT_TALL;
  const weights = [palette.weightLeft, palette.weightRight].map((color, i) => {
    const weight = solid(
      new RoundedBoxGeometry(
        PULLEY_WEIGHT_WIDTH,
        weightHeight,
        PULLEY_WEIGHT_WIDTH,
        2,
        0.035,
      ),
      color,
    );
    const rope = solid(
      new THREE.CylinderGeometry(0.021, 0.021, 1, 8),
      palette.rope,
    );
    weight.position.x = rope.position.x = (i === 0 ? -1 : 1) * PULLEY_RADIUS;
    root.add(weight, rope);
    return { weight, rope };
  });
  // A spring from the base to the right weight, when the pulley has one.
  const coil =
    object.springStiffness > 0
      ? solid(
          new THREE.TubeGeometry(new Helix(0.16, 10), 300, 0.016, 6),
          palette.coil,
        )
      : undefined;
  if (coil) {
    coil.position.set(PULLEY_RADIUS, PULLEY_BASE_HEIGHT, 0);
    root.add(coil);
  }
  root.userData.update = () => {
    const state = simulation()?.pulley(object.id);
    wheel.rotation.z = -(state?.wheelAngle ?? 0);
    weights.forEach(({ weight, rope }, i) => {
      weight.position.y =
        (i === 0 ? state?.left.y : state?.right.y) ?? PULLEY_WEIGHT_HEIGHT;
      const ropeBottom = weight.position.y + weightHeight / 2;
      rope.scale.y = PULLEY_HEIGHT - ropeBottom;
      rope.position.y = (PULLEY_HEIGHT + ropeBottom) / 2;
      if (coil && i === 1)
        coil.scale.y = Math.max(
          weight.position.y - weightHeight / 2 - PULLEY_BASE_HEIGHT,
          0.01,
        );
    });
  };
  return root;
}

/** A selection cage around a round part: the edges of a coarse icosahedron. */
const cage = (radius: number, color: THREE.ColorRepresentation) => {
  const shape = new THREE.IcosahedronGeometry(radius * 1.04, 1);
  const outline = edges(shape, color);
  shape.dispose();
  return outline;
};

/** A ball with an equatorial band, so its rolling shows. */
function ballMesh(
  object: Ball,
  palette: ViewportPalette,
  simulation: () => Simulation | undefined,
): Drawable {
  const mesh = solid(
    new THREE.SphereGeometry(object.radius, 32, 20),
    palette.ball,
  );
  const band = solid(
    new THREE.TorusGeometry(object.radius, object.radius * 0.06, 8, 48),
    palette.ballBand,
  );
  const outline = cage(object.radius, palette.partEdge);
  mesh.add(band, outline);
  const initial = initialBlockState(object);
  return {
    root: mesh,
    outline,
    update: () => {
      const { position, rotation } = simulation()?.block(object.id) ?? initial;
      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
  };
}

/** A cylinder lying along z, with a stripe along its side so its rolling shows. */
function cylinderMesh(
  object: Cylinder,
  palette: ViewportPalette,
  simulation: () => Simulation | undefined,
): Drawable {
  const { radius, length } = object;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 40);
  geometry.rotateX(Math.PI / 2);
  const mesh = solid(geometry, palette.ball);
  const stripe = solid(
    new THREE.BoxGeometry(radius * 0.16, radius * 0.08, length * 1.002),
    palette.ballBand,
  );
  stripe.position.y = radius * 0.97;
  const outline = edges(geometry, palette.partEdge);
  mesh.add(stripe, outline);
  const initial = initialBlockState(object);
  return {
    root: mesh,
    outline,
    update: () => {
      const { position, rotation } = simulation()?.block(object.id) ?? initial;
      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
  };
}

/** Points along a rope from the pivot to the bob, in the pendulum's frame. */
const ROPE_POINTS = 24;

/**
 * Lays a rope of `length` between the pivot and the bob. A slack rope hangs below its
 * chord as a parabola with the sag s that gives it the length, L ≈ c + 8 s²/(3 c).
 */
export function ropePoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  length: number,
): { x: number; y: number }[] {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const slack = Math.max(0, length - chord);
  const sag = chord > 1e-6 ? Math.sqrt((3 * chord * slack) / 8) : length / 2;
  return Array.from({ length: ROPE_POINTS }, (_, index) => {
    const u = index / (ROPE_POINTS - 1);
    return {
      x: from.x + u * (to.x - from.x),
      y: from.y + u * (to.y - from.y) - 4 * sag * u * (1 - u),
    };
  });
}

/**
 * A pivot, a link and a bob; the link follows the bob the engine moves. A rod is a bar,
 * thicker when it has mass; a rope is a line that sags when slack.
 */
function pendulumMesh(
  object: Pendulum,
  palette: ViewportPalette,
  gravity: number,
  simulation: () => Simulation | undefined,
): Drawable {
  const root = new THREE.Group();
  root.position.set(object.x, 0, object.z);
  const pivot = solid(new THREE.BoxGeometry(0.3, 0.14, 0.3), palette.frame);
  pivot.position.y = object.pivotHeight + 0.07;
  const hub = solid(new THREE.SphereGeometry(0.06, 16, 12), palette.hub);
  hub.position.y = object.pivotHeight;
  const thickness = object.rodMass > 0 ? 0.045 : 0.018;
  const rod = solid(
    new THREE.CylinderGeometry(thickness, thickness, 1, 8),
    palette.rope,
  );
  const rope = new THREE.Line(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(ROPE_POINTS * 3), 3),
    ),
    new THREE.LineBasicMaterial({ color: palette.rope }),
  );
  const link = object.link === "rope" ? rope : rod;
  disposeTree(object.link === "rope" ? rod : rope);
  const bob = solid(
    new THREE.SphereGeometry(object.bobRadius, 28, 18),
    palette.bob,
  );
  const outline = cage(object.bobRadius, palette.partEdge);
  bob.add(outline);
  root.add(pivot, hub, link, bob);
  const initial = initialBlockState(object, gravity);
  return {
    root,
    outline,
    update: () => {
      const { position } = simulation()?.block(object.id) ?? initial;
      const dx = position.x - object.x;
      const dy = object.pivotHeight - position.y;
      bob.position.set(dx, position.y, position.z - object.z);
      if (object.link === "rope") {
        const points = ropePoints(
          { x: 0, y: object.pivotHeight },
          { x: dx, y: position.y },
          object.length,
        );
        const buffer = rope.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        points.forEach(({ x, y }, index) => buffer.setXYZ(index, x, y, 0));
        buffer.needsUpdate = true;
        rope.geometry.computeBoundingSphere();
        return;
      }
      rod.scale.y = Math.hypot(dx, dy);
      rod.position.set(dx / 2, object.pivotHeight - dy / 2, 0);
      rod.rotation.z = Math.atan2(dx, dy);
    },
  };
}

/** A helix of unit height along y, scaled to the spring's current length. */
class Helix extends THREE.Curve<THREE.Vector3> {
  readonly radius: number;
  readonly turns: number;
  constructor(radius: number, turns: number) {
    super();
    this.radius = radius;
    this.turns = turns;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const angle = 2 * Math.PI * this.turns * t;
    return target.set(
      this.radius * Math.cos(angle),
      t,
      this.radius * Math.sin(angle),
    );
  }
}

/** An anchor plate, a coil and the cube it holds; the coil stretches with the cube. */
function springMesh(
  object: Spring,
  palette: ViewportPalette,
  gravity: number,
  simulation: () => Simulation | undefined,
): Drawable {
  const root = new THREE.Group();
  root.position.set(object.x, 0, object.z);
  const anchor = solid(new THREE.BoxGeometry(0.8, 0.1, 0.8), palette.frame);
  anchor.position.y = object.anchorHeight + 0.05;
  const coilRadius = Math.min(0.18, object.size * 0.3);
  const coil = solid(
    new THREE.TubeGeometry(new Helix(coilRadius, 12), 360, 0.018, 6),
    palette.coil,
  );
  const cube = solid(
    new RoundedBoxGeometry(object.size, object.size, object.size, 3, 0.04),
    palette.block,
  );
  const outline = edges(cube.geometry, palette.blockEdge);
  cube.add(outline);
  root.add(anchor, coil, cube);
  const initial = initialBlockState(object, gravity);
  return {
    root,
    outline,
    update: () => {
      const { position } = simulation()?.block(object.id) ?? initial;
      const top = position.y + object.size / 2;
      cube.position.y = position.y;
      coil.position.y = top;
      coil.scale.y = Math.max(object.anchorHeight - top, 0.01);
    },
  };
}

const BUMPER_PAD = 0.08;
const BUMPER_PAD_HEIGHT = 1;
const BUMPER_COIL_Y = 0.6;

/**
 * A wall, a coil and the pad on its end. The pad sits at the spring's free length and moves
 * towards the wall as the simulation reports compression.
 */
function bumperMesh(
  object: Bumper,
  palette: ViewportPalette,
  simulation: () => Simulation | undefined,
): Drawable {
  const direction = bumperDirection(object);
  const root = new THREE.Group();
  root.position.set(object.x, 0, object.z);
  const wall = solid(
    new THREE.BoxGeometry(BUMPER_WALL, BUMPER_HEIGHT, BUMPER_DEPTH),
    palette.frame,
  );
  wall.position.y = BUMPER_HEIGHT / 2;
  const coil = solid(
    new THREE.TubeGeometry(new Helix(0.24, 9), 270, 0.022, 6),
    palette.coil,
  );
  coil.rotation.z = direction > 0 ? -Math.PI / 2 : Math.PI / 2;
  coil.position.set((direction * BUMPER_WALL) / 2, BUMPER_COIL_Y, 0);
  const pad = solid(
    new THREE.BoxGeometry(BUMPER_PAD, BUMPER_PAD_HEIGHT, BUMPER_DEPTH * 0.8),
    palette.weightLeft,
  );
  pad.position.y = BUMPER_COIL_Y;
  root.add(wall, coil, pad);

  const reach = BUMPER_WALL / 2 + object.restLength;
  const bounds = new THREE.BoxGeometry(
    reach + BUMPER_WALL / 2,
    BUMPER_HEIGHT,
    BUMPER_DEPTH,
  );
  const outline = edges(bounds, palette.partEdge);
  bounds.dispose();
  outline.position.set(
    (direction * (reach - BUMPER_WALL / 2)) / 2,
    BUMPER_HEIGHT / 2,
    0,
  );
  root.add(outline);

  const update = () => {
    const compression = Math.min(
      simulation()?.bumper(object.id)?.compression ?? 0,
      object.restLength,
    );
    const face = reach - compression;
    pad.position.x = direction * (face - BUMPER_PAD / 2);
    coil.scale.y = Math.max(face - BUMPER_PAD - BUMPER_WALL / 2, 0.01);
  };
  update();
  return { root, outline, update };
}

function disposeTree(object: THREE.Object3D) {
  object.traverse((part) => {
    if (!(part instanceof THREE.Mesh || part instanceof THREE.Line)) return;
    part.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(part.material)
      ? part.material
      : [part.material];
    materials.forEach((material) => material.dispose());
  });
}

function createView(
  host: HTMLDivElement,
  onSelect: (id: string | null) => void,
  onMove: (id: string, offset: PartMove) => void,
): View {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute("aria-label", "3D view of the experiment");
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-describedby", "motion-viewport-help");
  host.append(canvas);

  const palette = documentViewportPalette();
  const stage = new THREE.Scene();
  stage.background = new THREE.Color(palette.background);
  stage.add(
    new THREE.HemisphereLight(palette.skyLight, palette.groundLight, 2.25),
  );
  const sun = new THREE.DirectionalLight(palette.sun, 2.1);
  sun.position.set(-7, 13, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -13;
  sun.shadow.camera.right = sun.shadow.camera.top = 13;
  sun.shadow.camera.far = 40;
  sun.shadow.normalBias = 0.035;
  stage.add(sun);

  const floor = solid(new THREE.BoxGeometry(100, 0.25, 100), palette.floor);
  floor.position.y = -0.126;
  floor.castShadow = false;
  stage.add(floor);
  const grid = new THREE.GridHelper(
    48,
    48,
    palette.gridMajor,
    palette.gridMinor,
  );
  grid.position.y = 0.006;
  stage.add(grid);
  const parts = new THREE.Group();
  stage.add(parts);
  const gizmo = createMoveGizmo(palette);
  stage.add(gizmo.root);
  // Shows the dragged part's new coordinates beside the pointer.
  const readout = document.createElement("div");
  readout.className = "lab-drag-readout";
  readout.hidden = true;
  readout.setAttribute("aria-hidden", "true");
  host.append(readout);

  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 240);
  camera.position.set(8, 7.5, 13);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.11;
  controls.maxPolarAngle = Math.PI / 2 - 0.025;
  controls.minZoom = 0.38;
  controls.maxZoom = 3.7;
  controls.update();
  controls.saveState();

  const drawables = new Map<string, Drawable>();
  let scene: LabScene | undefined;
  let options: ViewOptions = {
    active: true,
    running: false,
    editable: true,
    axis: "plane",
  };
  let dirty = true;
  let time = -1;
  let frame = 0;
  let selected: string | null = null;
  const getSimulation = () => options.simulation;
  const invalidate = () => {
    dirty = true;
    if (!frame && options.active) frame = requestAnimationFrame(draw);
  };
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    const ratio = width / height;
    const halfHeight = Math.max(4.15, 5.3 / ratio);
    camera.left = -halfHeight * ratio;
    camera.right = halfHeight * ratio;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const ray = new THREE.Raycaster();
  let click: { pointerId: number; x: number; y: number } | undefined;
  let gesture:
    | {
        id: string;
        pointerId: number;
        start: THREE.Vector3;
        screen: THREE.Vector2;
        plane: THREE.Plane;
        pixelsPerMetre: number;
        axis: ViewOptions["axis"] | MoveAxis;
        /** On-screen image of one metre along a move arrow, in CSS pixels. */
        axisPixels?: THREE.Vector2;
        offset?: PartMove;
      }
    | undefined;
  let hovered: MoveAxis | undefined;
  const toScreen = (point: THREE.Vector3) => {
    const projected = point.clone().project(camera);
    return new THREE.Vector2(
      ((projected.x + 1) / 2) * canvas.clientWidth,
      ((1 - projected.y) / 2) * canvas.clientHeight,
    );
  };
  const metresPerPixel = () =>
    (camera.top - camera.bottom) /
    camera.zoom /
    Math.max(1, canvas.clientHeight);
  const setRay = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      ),
      camera,
    );
  };
  const pick = (event: PointerEvent) => {
    setRay(event);
    for (const hit of ray.intersectObjects(
      [...drawables.values()].map(({ root }) => root),
      true,
    )) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      let part: THREE.Object3D | null = hit.object;
      while (part && !part.userData.id) part = part.parent;
      if (part) return { id: part.userData.id as string, point: hit.point };
    }
  };
  /** The move arrow under the pointer, when the arrows are shown. */
  const pickArrow = (event: PointerEvent): MoveAxis | undefined => {
    if (!gizmo.root.visible) return undefined;
    setRay(event);
    const shown = gizmo.targets.filter((target) => target.parent?.visible);
    const hit = ray.intersectObjects(shown, false)[0];
    return hit?.object.userData.axis as MoveAxis | undefined;
  };
  const down = (event: PointerEvent) => {
    if (
      gesture ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    click = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    const arrow = options.editable && selected ? pickArrow(event) : undefined;
    const held = arrow && scene?.objects.find(({ id }) => id === selected);
    if (arrow && held) {
      const origin = new THREE.Vector3().copy(gizmoOrigin(held));
      const unit = origin.clone();
      unit[arrow] += 1;
      gesture = {
        id: held.id,
        pointerId: event.pointerId,
        start: origin,
        screen: new THREE.Vector2(event.clientX, event.clientY),
        plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y),
        pixelsPerMetre: 1,
        axis: arrow,
        axisPixels: toScreen(unit).sub(toScreen(origin)),
      };
      click = undefined;
      canvas.setPointerCapture(event.pointerId);
      controls.enabled = false;
      canvas.focus({ preventScroll: true });
      invalidate();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const hit = pick(event);
    if (!options.editable || !hit || !scene) return;
    const part = scene.objects.find(({ id }) => id === hit.id);
    const axis =
      options.axis === "height" && part && movableAxes(part).includes("y")
        ? "height"
        : "plane";
    const pointY = hit.point.clone().project(camera).y;
    const higherY = hit.point
      .clone()
      .add(new THREE.Vector3(0, 1, 0))
      .project(camera).y;
    gesture = {
      id: hit.id,
      pointerId: event.pointerId,
      start: hit.point,
      screen: new THREE.Vector2(event.clientX, event.clientY),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
      pixelsPerMetre: Math.max(
        1,
        ((higherY - pointY) * canvas.clientHeight) / 2,
      ),
      axis,
    };
    click = undefined;
    canvas.setPointerCapture(event.pointerId);
    controls.enabled = false;
    canvas.focus({ preventScroll: true });
    onSelect(hit.id);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const hover = (event: PointerEvent) => {
    if (gesture || event.buttons) return;
    const next = options.editable && selected ? pickArrow(event) : undefined;
    if (next === hovered) return;
    hovered = next;
    canvas.style.cursor = next ? "pointer" : "";
    invalidate();
  };
  const updateDrag = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) {
      hover(event);
      return;
    }
    if (
      !gesture.offset &&
      gesture.screen.distanceTo(
        new THREE.Vector2(event.clientX, event.clientY),
      ) < 3
    )
      return;
    if (gesture.axisPixels) {
      const along = axisOffset(gesture.axisPixels, {
        x: event.clientX - gesture.screen.x,
        y: event.clientY - gesture.screen.y,
      });
      if (along === undefined) return;
      const axis = gesture.axis as MoveAxis;
      gesture.offset = { x: 0, y: 0, z: 0, [axis]: snapOffset(along) };
    } else if (gesture.axis === "height") {
      gesture.offset = {
        x: 0,
        y: (gesture.screen.y - event.clientY) / gesture.pixelsPerMetre,
        z: 0,
      };
    } else {
      setRay(event);
      const point = ray.ray.intersectPlane(gesture.plane, new THREE.Vector3());
      if (!point) return;
      gesture.offset = {
        x: point.x - gesture.start.x,
        y: 0,
        z: point.z - gesture.start.z,
      };
    }
    canvas.dataset.dragging = "true";
    canvas.style.cursor = "grabbing";
    const bounds = canvas.getBoundingClientRect();
    readout.style.left = `${event.clientX - bounds.left + 16}px`;
    readout.style.top = `${event.clientY - bounds.top + 16}px`;
    invalidate();
  };
  function finishDrag(commit: boolean) {
    if (!gesture) return;
    const { id, offset, pointerId } = gesture;
    gesture = undefined;
    if (canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId);
    controls.enabled = true;
    delete canvas.dataset.dragging;
    canvas.style.cursor = hovered ? "pointer" : "";
    readout.hidden = true;
    invalidate();
    if (commit && offset && options.editable) onMove(id, offset);
  }
  const up = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId) {
      updateDrag(event);
      finishDrag(true);
      return;
    }
    if (click?.pointerId !== event.pointerId) return;
    const { x, y } = click;
    click = undefined;
    if (Math.hypot(event.clientX - x, event.clientY - y) <= 5) {
      onSelect(pick(event)?.id ?? null);
    }
  };
  const cancel = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId) finishDrag(false);
    if (click?.pointerId === event.pointerId) click = undefined;
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && gesture) {
      event.preventDefault();
      finishDrag(false);
      return;
    }
    if (
      !selected ||
      !options.editable ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const step = event.shiftKey ? 1 : 0.1;
    let offset: PartMove;
    switch (event.key) {
      case "ArrowLeft":
        offset = { x: -step, y: 0, z: 0 };
        break;
      case "ArrowRight":
        offset = { x: step, y: 0, z: 0 };
        break;
      case "ArrowUp":
        offset = { x: 0, y: 0, z: -step };
        break;
      case "ArrowDown":
        offset = { x: 0, y: 0, z: step };
        break;
      case "PageUp":
        offset = { x: 0, y: step, z: 0 };
        break;
      case "PageDown":
        offset = { x: 0, y: -step, z: 0 };
        break;
      default:
        return;
    }
    event.preventDefault();
    onMove(selected, offset);
  };
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("pointermove", updateDrag);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("keydown", keydown);
  controls.addEventListener("change", invalidate);

  function draw() {
    frame = 0;
    if (!options.active) return;
    const moved = controls.update();
    const nextTime = options.simulation?.time ?? 0;
    if (dirty || time !== nextTime || moved) {
      for (const drawable of drawables.values()) {
        drawable.update?.();
        // Group-based drawables store their fixed base here after mounting.
        if (drawable.base) drawable.root.position.copy(drawable.base);
      }
      const draft =
        gesture?.offset && scene
          ? movePart(scene, gesture.id, gesture.offset)
          : scene;
      if (draft && scene && draft !== scene) {
        draft.objects.forEach((part, index) => {
          const before = scene!.objects[index];
          const item = drawables.get(part.id);
          if (!item || before === part) return;
          const y =
            isBody(part) && isBody(before)
              ? part.y - before.y
              : part.kind === "pendulum" && before.kind === "pendulum"
                ? part.pivotHeight - before.pivotHeight
                : part.kind === "spring" && before.kind === "spring"
                  ? part.anchorHeight - before.anchorHeight
                  : 0;
          item.root.position.x += part.x - before.x;
          item.root.position.y += y;
          item.root.position.z += part.z - before.z;
          if (item.arrow) {
            item.arrow.position.x += part.x - before.x;
            item.arrow.position.y += y;
            item.arrow.position.z += part.z - before.z;
          }
        });
      }
      const part =
        selected && options.editable && !options.running
          ? (draft ?? scene)?.objects.find(({ id }) => id === selected)
          : undefined;
      gizmo.root.visible = !!part;
      if (part) {
        const dragged =
          gesture?.axisPixels !== undefined
            ? (gesture.axis as MoveAxis)
            : undefined;
        gizmo.show(movableAxes(part), dragged ?? hovered);
        gizmo.place(gizmoOrigin(part), metresPerPixel());
      }
      if (gesture?.offset && part) {
        const origin = gizmoOrigin(part);
        const axes: readonly MoveAxis[] =
          gesture.axis === "plane"
            ? ["x", "z"]
            : gesture.axis === "height"
              ? ["y"]
              : [gesture.axis];
        readout.textContent = axes
          .map((axis) => `${axis} ${origin[axis].toFixed(2)} m`)
          .join(" · ");
        readout.hidden = false;
      }
      renderer.render(stage, camera);
      dirty = false;
      time = nextTime;
    }
    if (!frame && (options.running || moved))
      frame = requestAnimationFrame(draw);
  }

  function select(id: string | null) {
    selected = id;
    drawables.forEach(({ outline }, key) => {
      outline.visible = key === id;
    });
    invalidate();
  }

  return {
    mount(next) {
      finishDrag(false);
      scene = next;
      disposeTree(parts);
      parts.clear();
      drawables.clear();
      next.objects.forEach((object: LabObject) => {
        let drawable: Drawable;
        if (object.kind === "block") {
          const mesh = solid(
            new RoundedBoxGeometry(
              object.size,
              object.size,
              object.size,
              3,
              0.045,
            ),
            palette.block,
          );
          const bounds = new THREE.BoxGeometry(
            object.size * 1.025,
            object.size * 1.025,
            object.size * 1.025,
          );
          const outline = edges(bounds, palette.blockEdge);
          bounds.dispose();
          mesh.add(outline);
          const initial = initialBlockState(object);
          drawable = {
            root: mesh,
            outline,
            update: () => {
              const { position, rotation } =
                getSimulation()?.block(object.id) ?? initial;
              mesh.position.set(position.x, position.y, position.z);
              mesh.quaternion.set(
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w,
              );
            },
          };
        } else if (object.kind === "ball") {
          drawable = ballMesh(object, palette, getSimulation);
        } else if (object.kind === "cylinder") {
          drawable = cylinderMesh(object, palette, getSimulation);
        } else if (object.kind === "pendulum") {
          drawable = pendulumMesh(object, palette, next.gravity, getSimulation);
        } else if (object.kind === "spring") {
          drawable = springMesh(object, palette, next.gravity, getSimulation);
        } else if (object.kind === "bumper") {
          drawable = bumperMesh(object, palette, getSimulation);
        } else if (object.kind === "ramp") {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(rampVertices(object), 3),
          );
          geometry.setIndex([
            0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 0, 2, 5, 0, 5, 3, 2, 1, 4, 2, 4,
            5,
          ]);
          const flat = geometry.toNonIndexed();
          geometry.dispose();
          flat.computeVertexNormals();
          const mesh = solid(flat, palette.ramp);
          const outline = edges(flat, palette.partEdge);
          mesh.position.set(object.x, 0, object.z);
          mesh.add(outline);
          drawable = {
            root: mesh,
            outline,
            update: () => mesh.position.set(object.x, 0, object.z),
          };
        } else {
          const root = pulleyMesh(object, palette, getSimulation);
          const bounds = new THREE.BoxGeometry(2.05, 4.65, 1.18);
          const outline = edges(bounds, palette.partEdge);
          bounds.dispose();
          outline.position.y = 2.325;
          root.position.set(object.x, 0, object.z);
          root.add(outline);
          drawable = {
            root,
            outline,
            update: root.userData.update as () => void,
          };
        }
        if (isBody(object) && object.force) {
          const { arrow, update } = forceArrow(object, palette, getSimulation);
          drawable.arrow = arrow;
          const body = drawable.update;
          drawable.update = () => {
            body?.();
            update();
          };
          parts.add(arrow);
        }
        drawable.root.userData.id = object.id;
        if (drawable.root instanceof THREE.Group)
          drawable.base = drawable.root.position.clone();
        drawable.update?.();
        parts.add(drawable.root);
        drawables.set(object.id, drawable);
      });
      select(selected);
    },
    update(next) {
      options = next;
      if (!next.active || !next.editable) finishDrag(false);
      if (!next.active && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      invalidate();
    },
    select,
    reset() {
      controls.reset();
      invalidate();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", updateDrag);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("keydown", keydown);
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      gizmo.dispose();
      readout.remove();
      disposeTree(stage);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function LabViewport({
  scene,
  simulation,
  selected,
  onSelect,
  onMove,
  active,
  running,
  editable,
  axis,
  viewRevision,
}: {
  scene: LabScene;
  simulation?: Simulation;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, offset: PartMove) => void;
  active: boolean;
  running: boolean;
  editable: boolean;
  axis: ViewOptions["axis"];
  viewRevision: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [available, setAvailable] = useState(true);
  const move = useRef(onMove);
  useEffect(() => {
    move.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!host.current) return;
    try {
      const current = createView(host.current, onSelect, (id, offset) =>
        move.current(id, offset),
      );
      view.current = current;
      return () => {
        current.dispose();
        view.current = null;
      };
    } catch {
      const frame = requestAnimationFrame(() => setAvailable(false));
      return () => cancelAnimationFrame(frame);
    }
  }, [onSelect]);

  useEffect(() => {
    view.current?.update({ active, running, editable, axis, simulation });
  }, [active, running, editable, axis, simulation]);
  useEffect(() => {
    view.current?.mount(scene);
  }, [scene]);
  useEffect(() => {
    view.current?.select(selected);
  }, [selected]);
  useEffect(() => {
    view.current?.reset();
  }, [viewRevision]);

  return (
    <div className="lab-viewport" ref={host}>
      {!available && (
        <p className="lab-viewport-error" role="status">
          The 3D view needs WebGL 2. You can still run the experiment and read
          its measurements in the data dock.
        </p>
      )}
    </div>
  );
}
