import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { isBody } from "./scene";
import type {
  Ball,
  Body,
  Cylinder,
  LabScene,
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
  current: Simulation | undefined,
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
    const time = current?.time ?? 0;
    const position = current?.block(object.id)?.position ?? object;
    arrow.position.set(position.x, position.y, position.z);
    arrow.visible = magnitude > 0 && time < force.end;
  };
  return { arrow, update };
}

type Drawable = {
  root: THREE.Object3D;
  outline: THREE.LineSegments;
  update?: () => void;
};
type View = {
  mount: (scene: LabScene, simulation?: Simulation) => void;
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
  simulation?: Simulation,
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
  root.userData.update = () => {
    const state = simulation?.pulley(object.id);
    wheel.rotation.z = -(state?.wheelAngle ?? 0);
    weights.forEach(({ weight, rope }, i) => {
      weight.position.y =
        (i === 0 ? state?.left.y : state?.right.y) ?? PULLEY_WEIGHT_HEIGHT;
      const ropeBottom = weight.position.y + weightHeight / 2;
      rope.scale.y = PULLEY_HEIGHT - ropeBottom;
      rope.position.y = (PULLEY_HEIGHT + ropeBottom) / 2;
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
  simulation?: Simulation,
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
      const { position, rotation } = simulation?.block(object.id) ?? initial;
      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
  };
}

/** A cylinder lying along z, with a stripe along its side so its rolling shows. */
function cylinderMesh(
  object: Cylinder,
  palette: ViewportPalette,
  simulation?: Simulation,
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
      const { position, rotation } = simulation?.block(object.id) ?? initial;
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
  simulation?: Simulation,
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
      const { position } = simulation?.block(object.id) ?? initial;
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
  simulation?: Simulation,
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
      const { position } = simulation?.block(object.id) ?? initial;
      const top = position.y + object.size / 2;
      cube.position.y = position.y;
      coil.position.y = top;
      coil.scale.y = Math.max(object.anchorHeight - top, 0.01);
    },
  };
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
): View {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute("aria-label", "3D view of the experiment");
  host.append(renderer.domElement);

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
  let dirty = true;
  let time = -1;
  let simulation: Simulation | undefined;
  let frame = 0;
  let selected: string | null = null;
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
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const ray = new THREE.Raycaster();
  let pointer = { x: 0, y: 0 };
  const down = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
  };
  const up = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5
    )
      return;
    const bounds = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      ),
      camera,
    );
    for (const hit of ray.intersectObjects(parts.children, true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      let part: THREE.Object3D | null = hit.object;
      while (part && !part.userData.id) part = part.parent;
      if (part) {
        onSelect(part.userData.id as string);
        return;
      }
    }
    onSelect(null);
  };
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);

  const animate = () => {
    frame = requestAnimationFrame(animate);
    const moved = controls.update();
    const nextTime = simulation?.time ?? 0;
    if (!dirty && time === nextTime && !moved) return;
    drawables.forEach(({ update }) => update?.());
    renderer.render(stage, camera);
    dirty = false;
    time = nextTime;
  };
  animate();

  function select(id: string | null) {
    selected = id;
    drawables.forEach(({ outline }, key) => {
      outline.visible = key === id;
    });
    dirty = true;
  }

  return {
    mount(scene, current) {
      simulation = current;
      disposeTree(parts);
      parts.clear();
      drawables.clear();
      scene.objects.forEach((object) => {
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
          const outline = edges(mesh.geometry, palette.blockEdge);
          mesh.add(outline);
          const initial = initialBlockState(object);
          drawable = {
            root: mesh,
            outline,
            update: () => {
              const { position, rotation } =
                current?.block(object.id) ?? initial;
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
          drawable = ballMesh(object, palette, current);
        } else if (object.kind === "cylinder") {
          drawable = cylinderMesh(object, palette, current);
        } else if (object.kind === "pendulum") {
          drawable = pendulumMesh(object, palette, scene.gravity, current);
        } else if (object.kind === "spring") {
          drawable = springMesh(object, palette, scene.gravity, current);
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
          drawable = { root: mesh, outline };
        } else {
          const root = pulleyMesh(object, palette, current);
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
          const { arrow, update } = forceArrow(object, palette, current);
          const body = drawable.update;
          drawable.update = () => {
            body?.();
            update();
          };
          parts.add(arrow);
        }
        drawable.root.userData.id = object.id;
        drawable.update?.();
        parts.add(drawable.root);
        drawables.set(object.id, drawable);
      });
      select(selected);
    },
    select,
    reset() {
      controls.reset();
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      controls.dispose();
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
  viewRevision,
}: {
  scene: LabScene;
  simulation?: Simulation;
  selected: string | null;
  onSelect: (id: string | null) => void;
  viewRevision: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!host.current) return;
    try {
      const current = createView(host.current, onSelect);
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
    view.current?.mount(scene, simulation);
  }, [scene, simulation]);
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
