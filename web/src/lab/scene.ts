/** Versioned, SI-unit contract shared by the lab controls and headless simulations. */
export const SCENE_VERSION = "physix.lab/2";
/** Earlier versions `parseScene` still reads; each migrates to SCENE_VERSION. */
export const LEGACY_SCENE_VERSIONS = ["physix.lab/1"] as const;
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
  radius: [0.1, 1.5, 0.05],
  pivotHeight: [1, 20, 0.1],
  pendulumLength: [0.2, 10, 0.05],
  bobRadius: [0.05, 0.5, 0.01],
  swing: [-170, 170, 1],
  stiffness: [1, 5000, 1],
  damping: [0, 200, 0.1],
  restLength: [0.2, 10, 0.05],
  offset: [-5, 5, 0.01],
  wheelMass: [0, 20, 0.1],
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
/**
 * An Atwood machine: two weights on an inextensible rope over a wheel. The wheel is a
 * uniform disc of `wheelMass` kilograms (0 for a massless wheel) on a frictionless axle.
 */
export type Pulley = Placement & {
  kind: "pulley";
  leftMass: number;
  rightMass: number;
  wheelMass: number;
};
export type Ball = Placement & {
  kind: "ball";
  y: number;
  radius: number;
  mass: number;
  vx: number;
};
/**
 * A rigid pendulum: a solid bob on a massless rod, hinged about the z axis at
 * (x, pivotHeight, z). `angle` is the release angle from the downward vertical in degrees,
 * positive anticlockwise seen from +z; the bob starts at rest.
 */
export type Pendulum = Placement & {
  kind: "pendulum";
  pivotHeight: number;
  length: number;
  mass: number;
  bobRadius: number;
  angle: number;
};
/**
 * A cube hung from a fixed anchor by a linear spring and dashpot, moving only along y.
 * `offset` is the release position above equilibrium in metres; the cube starts at rest.
 */
export type Spring = Placement & {
  kind: "spring";
  anchorHeight: number;
  stiffness: number;
  damping: number;
  restLength: number;
  mass: number;
  size: number;
  offset: number;
};
export type LabObject = Block | Ramp | Pulley | Ball | Pendulum | Spring;
/** Free rigid bodies: they rest on ramps, slide or roll, fall and collide. */
export type Body = Block | Ball;
export type LabScene = {
  version: typeof SCENE_VERSION;
  name: string;
  gravity: number;
  floorFriction: number;
  objects: LabObject[];
};
export type Preset =
  | "incline"
  | "friction"
  | "projectile"
  | "pulley"
  | "rolling"
  | "pendulum"
  | "spring"
  | "blank";

export const objectNames: Record<LabObject["kind"], string> = {
  block: "Block",
  ball: "Ball",
  ramp: "Ramp",
  pulley: "Pulley",
  pendulum: "Pendulum",
  spring: "Spring",
};
export const presetNames: Record<Preset, string> = {
  incline: "Inclined plane",
  friction: "Friction track",
  projectile: "Projectile",
  pulley: "Atwood machine",
  rolling: "Rolling ball",
  pendulum: "Pendulum",
  spring: "Spring oscillator",
  blank: "Untitled experiment",
};

export const isBody = (part: LabObject): part is Body =>
  part.kind === "block" || part.kind === "ball";
/** Distance from a body's centre to its lowest point when upright, in metres. */
export const bodyHalf = (body: Body) =>
  body.kind === "block" ? body.size / 2 : body.radius;

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
  kind: "ball",
  id: string,
  x?: number,
  z?: number,
): Ball;
export function makeObject(
  kind: "pendulum",
  id: string,
  x?: number,
  z?: number,
): Pendulum;
export function makeObject(
  kind: "spring",
  id: string,
  x?: number,
  z?: number,
): Spring;
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
      return { ...placement, kind, leftMass: 2, rightMass: 3, wheelMass: 0 };
    case "ball":
      return { ...placement, kind, y: 0.5, radius: 0.5, mass: 2, vx: 0 };
    case "pendulum":
      return {
        ...placement,
        kind,
        pivotHeight: 5,
        length: 3,
        mass: 1,
        bobRadius: 0.2,
        angle: 20,
      };
    case "spring":
      return {
        ...placement,
        kind,
        anchorHeight: 6,
        stiffness: 80,
        damping: 0,
        restLength: 2,
        mass: 2,
        size: 0.6,
        offset: 0.5,
      };
  }
}

/** Static extension of a spring at equilibrium, in metres. */
export const springSag = (spring: Spring, gravity: number) =>
  (spring.mass * gravity) / spring.stiffness;

/** Centre height of a spring's cube at equilibrium. */
export const springEquilibrium = (spring: Spring, gravity: number) =>
  spring.anchorHeight -
  spring.restLength -
  springSag(spring, gravity) -
  spring.size / 2;

/** Why a pendulum or spring cannot swing freely in this gravity, or undefined. */
export function oscillatorProblem(
  part: Pendulum | Spring,
  gravity: number,
): string | undefined {
  if (part.kind === "pendulum")
    return part.pivotHeight - part.length - part.bobRadius < 0.05
      ? `${part.id}: the bob would reach the floor; raise the pivot above the length plus the bob radius.`
      : undefined;
  const centre = springEquilibrium(part, gravity);
  const reach = Math.abs(part.offset);
  if (centre - reach - part.size / 2 < 0.05)
    return `${part.id}: the cube would reach the floor; raise the anchor, stiffen the spring or reduce the offset.`;
  if (centre + reach + part.size / 2 > part.anchorHeight - 0.05)
    return `${part.id}: the cube would reach the anchor; lengthen the spring or reduce the offset.`;
}

/** Gap left between a placed body and the ramp surface, in metres. */
export const RAMP_CLEARANCE = 0.015;

export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const rampHeight = (ramp: Ramp) =>
  ramp.length * Math.tan(radians(ramp.angle));

/** Places a body at rest on a ramp; `fraction` runs from the top (0) to the foot (1). */
export function blockOnRamp<T extends Body>(
  block: T,
  ramp: Ramp,
  fraction = 0.23,
  lateral = 0,
): T {
  const tilt = radians(ramp.angle);
  const surfaceX = ramp.length * (fraction - 0.5);
  const clearance = bodyHalf(block) + RAMP_CLEARANCE;
  return {
    ...block,
    x: ramp.x + surfaceX + clearance * Math.sin(tilt),
    y:
      (ramp.length / 2 - surfaceX) * Math.tan(tilt) +
      clearance * Math.cos(tilt),
    z: ramp.z + lateral,
    ...(block.kind === "block" ? { rotation: -ramp.angle } : {}),
    vx: 0,
  };
}

/** Returns an on-surface starting position expressed relative to the ramp. */
export function rampPlacement(block: Body, ramp: Ramp) {
  if (block.kind === "block" && block.rotation !== -ramp.angle) return;
  if (block.vx !== 0) return;
  const normalOffset =
    (bodyHalf(block) + RAMP_CLEARANCE) * Math.sin(radians(ramp.angle));
  const fraction = (block.x - ramp.x - normalOffset) / ramp.length + 0.5;
  const lateral = block.z - ramp.z;
  if (fraction <= 0 || fraction >= 1 || Math.abs(lateral) > ramp.width / 2)
    return;
  const expected = blockOnRamp(block, ramp, fraction, lateral);
  if (Math.abs(block.y - expected.y) < 1e-6) return { fraction, lateral };
}

export function findRampPlacement<T extends Body>(
  block: T,
  ramp: Ramp,
  objects: LabObject[],
): T | undefined {
  const half = bodyHalf(block);
  if (2 * half > ramp.width) return;
  const edge = (half * Math.cos(radians(ramp.angle))) / ramp.length;
  for (const fraction of [0.23, 0.46, 0.69, 0.85]) {
    if (fraction < edge || fraction > 1 - edge) continue;
    const candidate = blockOnRamp(block, ramp, fraction);
    const blocked = objects.some(
      (other) =>
        isBody(other) &&
        other.id !== block.id &&
        Math.hypot(
          candidate.x - other.x,
          candidate.y - other.y,
          candidate.z - other.z,
        ) <
          half + bodyHalf(other) + 0.03,
    );
    if (!blocked) return candidate;
  }
}

/**
 * Replaces the object with `next`'s ID. Bodies that rest on a ramp being changed keep their
 * place on it, so a new angle or length carries them along.
 */
export function replaceObject(scene: LabScene, next: LabObject): LabScene {
  const previous = scene.objects.find((part) => part.id === next.id);
  const objects = scene.objects.map((part) => {
    if (part.id === next.id) return next;
    if (isBody(part) && previous?.kind === "ramp" && next.kind === "ramp") {
      const placement = rampPlacement(part, previous);
      if (placement)
        return blockOnRamp(part, next, placement.fraction, placement.lateral);
    }
    return part;
  });
  return { ...scene, objects };
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
    // The block starts resting on the floor, so friction acts from the first step.
    scene.objects = [{ ...makeObject("block", "block-1", -4), y: 0.5, vx: 5 }];
  } else if (preset === "projectile") {
    scene.objects = [{ ...makeObject("block", "block-1", -6), y: 6, vx: 4 }];
  } else if (preset === "pulley") {
    scene.objects = [makeObject("pulley", "pulley-1")];
  } else if (preset === "rolling") {
    const ramp = makeObject("ramp", "ramp-1");
    scene.objects = [ramp, blockOnRamp(makeObject("ball", "ball-1"), ramp)];
  } else if (preset === "pendulum") {
    // Inside the small-angle range, so both period references apply.
    scene.objects = [{ ...makeObject("pendulum", "pendulum-1"), angle: 8 }];
  } else if (preset === "spring") {
    scene.objects = [makeObject("spring", "spring-1")];
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
        // Optional, so physix.lab/1 pulleys and earlier lab/2 scenes keep a massless wheel.
        wheelMass:
          object.wheelMass === undefined
            ? 0
            : numeric(object, "wheelMass", limits.wheelMass),
      };
    case "ball":
      return {
        ...placement,
        kind,
        y: numeric(object, "y", limits.height),
        radius: numeric(object, "radius", limits.radius),
        mass: numeric(object, "mass", limits.mass),
        vx: numeric(object, "vx", limits.velocity),
      };
    case "pendulum":
      return {
        ...placement,
        kind,
        pivotHeight: numeric(object, "pivotHeight", limits.pivotHeight),
        length: numeric(object, "length", limits.pendulumLength),
        mass: numeric(object, "mass", limits.mass),
        bobRadius: numeric(object, "bobRadius", limits.bobRadius),
        angle: numeric(object, "angle", limits.swing),
      };
    case "spring":
      return {
        ...placement,
        kind,
        anchorHeight: numeric(object, "anchorHeight", limits.pivotHeight),
        stiffness: numeric(object, "stiffness", limits.stiffness),
        damping: numeric(object, "damping", limits.damping),
        restLength: numeric(object, "restLength", limits.restLength),
        mass: numeric(object, "mass", limits.mass),
        size: numeric(object, "size", limits.size),
        offset: numeric(object, "offset", limits.offset),
      };
    default:
      throw new Error(
        "Supported objects are blocks, balls, ramps, pulleys, pendulums and springs.",
      );
  }
}

const LEGACY_KINDS: readonly LabObject["kind"][] = ["block", "ramp", "pulley"];

/**
 * Validates a scene and returns it as SCENE_VERSION. A `physix.lab/1` scene holds only
 * blocks, ramps and pulleys with unchanged fields, so it migrates by its version alone; runs
 * of the migrated scene carry a new identity, since the identity hashes the scene.
 */
export function parseScene(input: unknown): LabScene {
  const scene = record(input, "Scene");
  const legacy = (LEGACY_SCENE_VERSIONS as readonly unknown[]).includes(
    scene.version,
  );
  if (scene.version !== SCENE_VERSION && !legacy)
    throw new Error(
      `Expected scene version ${SCENE_VERSION} or ${LEGACY_SCENE_VERSIONS.join(", ")}.`,
    );
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
  if (legacy && objects.some((part) => !LEGACY_KINDS.includes(part.kind)))
    throw new Error(
      `Balls, pendulums and springs need scene version ${SCENE_VERSION}.`,
    );
  const gravity = numeric(scene, "gravity", limits.gravity);
  for (const part of objects) {
    if (part.kind !== "pendulum" && part.kind !== "spring") continue;
    const problem = oscillatorProblem(part, gravity);
    if (problem) throw new Error(problem);
  }
  return {
    version: SCENE_VERSION,
    name: scene.name.trim(),
    gravity,
    floorFriction: numeric(scene, "floorFriction", limits.friction),
    objects,
  };
}
