/** Versioned, SI-unit contract shared by the lab controls and headless simulations. */
export const SCENE_VERSION = "physix.lab/1";
export const OBJECT_LIMIT = 32;

export const limits = {
  gravity: [0, 30, 0.01],
  friction: [0, 2, 0.01],
  position: [-20, 20, 0.1],
  height: [0, 20, 0.1],
  mass: [0.1, 100, 0.1],
  size: [0.3, 3, 0.1],
  rotation: [-180, 180, 1],
  velocity: [-20, 20, 0.1],
  length: [2, 12, 0.1],
  width: [1, 8, 0.1],
  angle: [5, 55, 1],
} as const;

type Placement = { id: string; x: number; z: number };
export type Block = Placement & {
  kind: "block";
  y: number;
  size: number;
  mass: number;
  rotation: number;
  vx: number;
};
export type Ramp = Placement & {
  kind: "ramp";
  length: number;
  width: number;
  angle: number;
  friction: number;
};
export type Pulley = Placement & {
  kind: "pulley";
  leftMass: number;
  rightMass: number;
};
export type LabObject = Block | Ramp | Pulley;
export type LabScene = {
  version: typeof SCENE_VERSION;
  name: string;
  gravity: number;
  floorFriction: number;
  objects: LabObject[];
};
export type Preset = "incline" | "friction" | "pulley" | "blank";

export const objectNames = { block: "Block", ramp: "Ramp", pulley: "Pulley" };
export const presetNames: Record<Preset, string> = {
  incline: "Inclined plane",
  friction: "Friction track",
  pulley: "Atwood machine",
  blank: "Untitled experiment",
};

export function makeObject(
  kind: "block",
  id: string,
  x?: number,
  z?: number,
): Block;
export function makeObject(
  kind: "ramp",
  id: string,
  x?: number,
  z?: number,
): Ramp;
export function makeObject(
  kind: "pulley",
  id: string,
  x?: number,
  z?: number,
): Pulley;
export function makeObject(
  kind: LabObject["kind"],
  id: string,
  x?: number,
  z?: number,
): LabObject;
export function makeObject(
  kind: LabObject["kind"],
  id: string,
  x = 0,
  z = 0,
): LabObject {
  const placement = { id, x, z };
  switch (kind) {
    case "block":
      return {
        ...placement,
        kind,
        y: 0.55,
        size: 1,
        mass: 2,
        rotation: 0,
        vx: 0,
      };
    case "ramp":
      return {
        ...placement,
        kind,
        length: 7,
        width: 3,
        angle: 26,
        friction: 0.2,
      };
    case "pulley":
      return { ...placement, kind, leftMass: 2, rightMass: 3 };
  }
}

export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const rampHeight = (ramp: Ramp) =>
  ramp.length * Math.tan(radians(ramp.angle));

export function blockOnRamp(
  block: Block,
  ramp: Ramp,
  fraction = 0.23,
  lateral = 0,
): Block {
  const tilt = radians(ramp.angle);
  const surfaceX = ramp.length * (fraction - 0.5);
  const clearance = block.size / 2 + 0.015;
  return {
    ...block,
    x: ramp.x + surfaceX + clearance * Math.sin(tilt),
    y:
      (ramp.length / 2 - surfaceX) * Math.tan(tilt) +
      clearance * Math.cos(tilt),
    z: ramp.z + lateral,
    rotation: -ramp.angle,
    vx: 0,
  };
}

/** Returns an on-surface starting position expressed relative to the ramp. */
export function rampPlacement(block: Block, ramp: Ramp) {
  if (block.rotation !== -ramp.angle || block.vx !== 0) return;
  const normalOffset = (block.size / 2 + 0.015) * Math.sin(radians(ramp.angle));
  const fraction = (block.x - ramp.x - normalOffset) / ramp.length + 0.5;
  const lateral = block.z - ramp.z;
  if (fraction <= 0 || fraction >= 1 || Math.abs(lateral) > ramp.width / 2)
    return;
  const expected = blockOnRamp(block, ramp, fraction, lateral);
  if (Math.abs(block.y - expected.y) < 1e-6) return { fraction, lateral };
}

export function findRampPlacement(
  block: Block,
  ramp: Ramp,
  objects: LabObject[],
): Block | undefined {
  if (block.size > ramp.width) return;
  const edge = (block.size * Math.cos(radians(ramp.angle))) / (2 * ramp.length);
  for (const fraction of [0.23, 0.46, 0.69, 0.85]) {
    if (fraction < edge || fraction > 1 - edge) continue;
    const candidate = blockOnRamp(block, ramp, fraction);
    const blocked = objects.some(
      (other) =>
        other.kind === "block" &&
        other.id !== block.id &&
        Math.hypot(
          candidate.x - other.x,
          candidate.y - other.y,
          candidate.z - other.z,
        ) <
          (block.size + other.size) / 2 + 0.03,
    );
    if (!blocked) return candidate;
  }
}
export function makeScene(preset: Preset): LabScene {
  const scene: LabScene = {
    version: SCENE_VERSION,
    name: presetNames[preset],
    gravity: 9.81,
    floorFriction: 0.35,
    objects: [],
  };
  if (preset === "incline") {
    const ramp = makeObject("ramp", "ramp-1");
    scene.objects = [ramp, blockOnRamp(makeObject("block", "block-1"), ramp)];
  } else if (preset === "friction") {
    scene.objects = [{ ...makeObject("block", "block-1", -4), vx: 5 }];
  } else if (preset === "pulley") {
    scene.objects = [makeObject("pulley", "pulley-1")];
  }
  return scene;
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error(`${label} must be an object.`);
  return input as Record<string, unknown>;
}

function numeric(
  input: Record<string, unknown>,
  key: string,
  range: readonly [number, number, number],
): number {
  const value = input[key];
  const [min, max] = range;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${key} must be a number between ${min} and ${max}.`);
  return value;
}

function parseObject(input: unknown): LabObject {
  const object = record(input, "Scene object");
  const { id, kind } = object;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(id))
    throw new Error(
      "Object IDs must use 1–48 letters, digits, underscores or hyphens.",
    );
  const placement = {
    id,
    x: numeric(object, "x", limits.position),
    z: numeric(object, "z", limits.position),
  };
  switch (kind) {
    case "block":
      return {
        ...placement,
        kind,
        y: numeric(object, "y", limits.height),
        size: numeric(object, "size", limits.size),
        mass: numeric(object, "mass", limits.mass),
        rotation: numeric(object, "rotation", limits.rotation),
        vx: numeric(object, "vx", limits.velocity),
      };
    case "ramp":
      return {
        ...placement,
        kind,
        length: numeric(object, "length", limits.length),
        width: numeric(object, "width", limits.width),
        angle: numeric(object, "angle", limits.angle),
        friction: numeric(object, "friction", limits.friction),
      };
    case "pulley":
      return {
        ...placement,
        kind,
        leftMass: numeric(object, "leftMass", limits.mass),
        rightMass: numeric(object, "rightMass", limits.mass),
      };
    default:
      throw new Error("Supported objects are blocks, ramps and pulleys.");
  }
}

export function parseScene(input: unknown): LabScene {
  const scene = record(input, "Scene");
  if (scene.version !== SCENE_VERSION)
    throw new Error(`Expected scene version ${SCENE_VERSION}.`);
  if (
    typeof scene.name !== "string" ||
    !scene.name.trim() ||
    scene.name.length > 80
  )
    throw new Error("The scene name must contain 1–80 characters.");
  if (!Array.isArray(scene.objects) || scene.objects.length > OBJECT_LIMIT)
    throw new Error(`A scene can contain up to ${OBJECT_LIMIT} objects.`);
  const objects = scene.objects.map(parseObject);
  if (new Set(objects.map((object) => object.id)).size !== objects.length)
    throw new Error("Every object needs a unique ID.");
  return {
    version: SCENE_VERSION,
    name: scene.name.trim(),
    gravity: numeric(scene, "gravity", limits.gravity),
    floorFriction: numeric(scene, "floorFriction", limits.friction),
    objects,
  };
}
