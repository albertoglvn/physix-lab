import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { LabScene, Pulley } from "./scene";
import {
  initialBlockState,
  PULLEY_HEIGHT,
  PULLEY_RADIUS,
  PULLEY_WEIGHT_HEIGHT,
  rampVertices,
  type Simulation,
} from "./simulation";

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

function solid(geometry: THREE.BufferGeometry, color: number) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function edges(geometry: THREE.BufferGeometry, color: number) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 24),
    new THREE.LineBasicMaterial({ color }),
  );
}

function pulleyMesh(object: Pulley, simulation?: Simulation): THREE.Group {
  const root = new THREE.Group();
  const frame = 0x57766d;
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
    0xd7a054,
  );
  disk.rotation.x = Math.PI / 2;
  const rim = solid(
    new THREE.TorusGeometry(PULLEY_RADIUS, 0.037, 8, 32),
    0x645544,
  );
  const hub = solid(new THREE.SphereGeometry(0.12, 16, 12), 0x515950);
  hub.position.z = 0.12;
  wheel.position.y = PULLEY_HEIGHT;
  wheel.add(disk, rim, hub);
  for (let i = 0; i < 5; i++) {
    const spoke = solid(new THREE.BoxGeometry(0.035, 0.34, 0.022), 0x8c6536);
    const pivot = new THREE.Group();
    spoke.position.set(0, 0.29, 0.103);
    pivot.rotation.z = (i * Math.PI * 2) / 5;
    pivot.add(spoke);
    wheel.add(pivot);
  }
  root.add(wheel);

  const weightHeight = 0.54;
  const weights = [0x7898b5, 0xc78161].map((color, i) => {
    const weight = solid(
      new RoundedBoxGeometry(0.5, weightHeight, 0.5, 2, 0.035),
      color,
    );
    const rope = solid(
      new THREE.CylinderGeometry(0.021, 0.021, 1, 8),
      0x655543,
    );
    weight.position.x = rope.position.x = (i === 0 ? -1 : 1) * PULLEY_RADIUS;
    root.add(weight, rope);
    return { weight, rope };
  });
  root.userData.update = () => {
    const displacement = simulation?.pulley(object.id)?.displacement ?? 0;
    wheel.rotation.z = -displacement / PULLEY_RADIUS;
    weights.forEach(({ weight, rope }, i) => {
      weight.position.y =
        PULLEY_WEIGHT_HEIGHT + (i === 0 ? displacement : -displacement);
      const ropeBottom = weight.position.y + weightHeight / 2;
      rope.scale.y = PULLEY_HEIGHT - ropeBottom;
      rope.position.y = (PULLEY_HEIGHT + ropeBottom) / 2;
    });
  };
  return root;
}

function disposeTree(object: THREE.Object3D) {
  object.traverse((part) => {
    if (!(part instanceof THREE.Mesh || part instanceof THREE.LineSegments))
      return;
    part.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(part.material)
      ? part.material
      : [part.material];
    materials.forEach((material) => material.dispose());
  });
}

function createView(
  host: HTMLDivElement,
  onSelect: (id: string) => void,
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

  const stage = new THREE.Scene();
  stage.background = new THREE.Color(0xeaf0e7);
  stage.add(new THREE.HemisphereLight(0xffffff, 0x84917f, 2.25));
  const sun = new THREE.DirectionalLight(0xfff6e1, 2.1);
  sun.position.set(-7, 13, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -13;
  sun.shadow.camera.right = sun.shadow.camera.top = 13;
  sun.shadow.camera.far = 40;
  sun.shadow.normalBias = 0.035;
  stage.add(sun);

  const floor = solid(new THREE.BoxGeometry(100, 0.25, 100), 0xe2eade);
  floor.position.y = -0.126;
  floor.castShadow = false;
  stage.add(floor);
  const grid = new THREE.GridHelper(48, 48, 0x9bad9e, 0xc6d3c4);
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
        break;
      }
    }
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
            0xedb765,
          );
          const outline = edges(mesh.geometry, 0x5a412a);
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
          const mesh = solid(flat, 0x83a398);
          const outline = edges(flat, 0x476d61);
          mesh.position.set(object.x, 0, object.z);
          mesh.add(outline);
          drawable = { root: mesh, outline };
        } else {
          const root = pulleyMesh(object, current);
          const bounds = new THREE.BoxGeometry(2.05, 4.65, 1.18);
          const outline = edges(bounds, 0x476d61);
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
  onSelect: (id: string) => void;
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
          its measurements below.
        </p>
      )}
    </div>
  );
}
