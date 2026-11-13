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
  rodMass: [0, 20, 0.1],
  swing: [-170, 170, 1],
  stiffness: [1, 5000, 1],
  damping: [0, 200, 0.1],
  restLength: [0.2, 10, 0.05],
  offset: [-5, 5, 0.01],
  wheelMass: [0, 20, 0.1],
  restitution: [0, 1, 0.01],
  cylinderLength: [0.2, 3, 0.05],
  airDensity: [0, 5, 0.01],
  linearDrag: [0, 10, 0.01],
  dragCoefficient: [0, 2, 0.01],
  force: [-500, 500, 0.1],
  forceTime: [0, 60, 0.01],
} as const;

/**
 * Representative dry-contact values for teaching, not measured pair data. The engine takes
 * the smaller friction coefficient and the larger restitution of the two parts in contact.
 */
export const MATERIALS = {
  wood: { label: "Wood", friction: 0.4, restitution: 0.5, density: 700 },
  steel: { label: "Steel", friction: 0.5, restitution: 0.6, density: 7850 },
  rubber: { label: "Rubber", friction: 1, restitution: 0.8, density: 1100 },
  ice: { label: "Ice", friction: 0.03, restitution: 0.1, density: 917 },
  felt: { label: "Felt", friction: 0.3, restitution: 0.05, density: 300 },
} as const;
export type MaterialName = keyof typeof MATERIALS;
export const materialNames = Object.keys(MATERIALS) as MaterialName[];

type Placement = { id: string; x: number; z: number };
/**
 * What a free body is made of. `restitution` (0 to 1) sets how it bounces. `friction` is
 * optional: without it the surface the body touches sets the coefficient, as in
 * `physix.lab/1`. `material` names the library entry the values came from, when they did.
 */
export type Surface = {
  material?: MaterialName;
  friction?: number;
  restitution: number;
  /** Quadratic drag coefficient C_d; without it the shape's typical value applies. */
  dragCoefficient?: number;
};
/**
 * A constant force in the x–y plane, in newtons, held at the centre of mass from `start`
 * up to `end` seconds. Its impulse is (x, y)·(end − start) whatever the time step.
 */
export type AppliedForce = { x: number; y: number; start: number; end: number };
/** Launch velocity in the x–y plane, m/s, and an optional applied force. */
export type Launch = { vx: number; vy: number; force?: AppliedForce };
export type Block = Placement &
  Surface &
  Launch & {
    kind: "block";
    y: number;
    size: number;
    mass: number;
    rotation: number;
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
export type Ball = Placement &
  Surface &
  Launch & {
    kind: "ball";
    y: number;
    radius: number;
    mass: number;
  };
/** A solid cylinder lying with its axis along z, so it rolls along x. */
export type Cylinder = Placement &
  Surface &
  Launch & {
    kind: "cylinder";
    y: number;
    radius: number;
    length: number;
    mass: number;
  };
/**
 * A rigid pendulum: a solid bob on a massless rod, hinged about the z axis at
 * (x, pivotHeight, z). `angle` is the release angle from the downward vertical in degrees,
 * positive anticlockwise seen from +z; the bob starts at rest.
 */
/**
 * How a pendulum's bob hangs from its pivot: a `rod` holds the bob at the length and turns
 * it with the swing; a `rope` only stops the bob going further than the length, so it goes
 * slack when the bob moves inwards, and the bob does not turn.
 */
export type PendulumLink = "rod" | "rope";
export const PENDULUM_LINKS: readonly PendulumLink[] = ["rod", "rope"];
export type Pendulum = Placement & {
  kind: "pendulum";
  pivotHeight: number;
  length: number;
  mass: number;
  bobRadius: number;
  angle: number;
  link: PendulumLink;
  /** Mass of a uniform rod from the pivot to the bob's centre, kg; 0 for a rope. */
  rodMass: number;
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
export type LabObject =
  Block | Ramp | Pulley | Ball | Cylinder | Pendulum | Spring;
/** Free rigid bodies: they rest on ramps, slide or roll, fall and collide. */
export type Body = Block | Ball | Cylinder;
/**
 * `airDensity` (kg/m³) gives free bodies quadratic drag ½ ρ C_d A v², and `linearDrag`
 * (N·s/m) adds b v. Both are 0 in vacuum and act on blocks, balls and cylinders only.
 */
export type LabScene = {
  version: typeof SCENE_VERSION;
  name: string;
  gravity: number;
  floorFriction: number;
  airDensity: number;
  linearDrag: number;
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
  | "launcher"
  | "bounce"
  | "collision"
  | "push"
  | "drag"
  | "compound"
  | "rope"
  | "blank";

export const objectNames: Record<LabObject["kind"], string> = {
  block: "Block",
  ball: "Ball",
  cylinder: "Cylinder",
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
  launcher: "Launcher",
  bounce: "Bouncing ball",
  collision: "Collision track",
  push: "Pushed block",
  drag: "Falling through air",
  compound: "Compound pendulum",
  rope: "Slack rope",
  blank: "Untitled experiment",
};

export const isBody = (part: LabObject): part is Body =>
  part.kind === "block" || part.kind === "ball" || part.kind === "cylinder";
/** Distance from a body's centre to its lowest point when upright, in metres. */
export const bodyHalf = (body: Body) =>
  body.kind === "block" ? body.size / 2 : body.radius;
/** A body's extent along z, in metres. */
export const bodyDepth = (body: Body) =>
  body.kind === "cylinder" ? body.length : 2 * bodyHalf(body);
/** A body's volume in m³. */
export function bodyVolume(body: Body) {
  if (body.kind === "block") return body.size ** 3;
  if (body.kind === "ball") return (4 / 3) * Math.PI * body.radius ** 3;
  return Math.PI * body.radius ** 2 * body.length;
}
/** Typical drag coefficients: a sphere, a cube face-on and a long cylinder broadside. */
export const DRAG_COEFFICIENTS = {
  ball: 0.47,
  block: 1.05,
  cylinder: 1.2,
} as const;
/** The body's drag coefficient: its own, or its shape's typical value. */
export const dragCoefficientOf = (body: Body) =>
  body.dragCoefficient ?? DRAG_COEFFICIENTS[body.kind];
/** Frontal area facing motion in the x–y plane, m²: the silhouette seen along the motion. */
export const frontalArea = (body: Body) =>
  body.kind === "ball"
    ? Math.PI * body.radius ** 2
    : body.kind === "block"
      ? body.size ** 2
      : 2 * body.radius * body.length;
/**
 * Drag on a body as F = −(b + c |v|) v: the scene's linear coefficient b in N·s/m and the
 * quadratic coefficient c = ½ ρ C_d A in kg/m.
 */
export const dragCoefficients = (body: Body, scene: LabScene) => ({
  linear: scene.linearDrag,
  quadratic:
    0.5 * scene.airDensity * dragCoefficientOf(body) * frontalArea(body),
});
/** The scene has air: some drag acts on free bodies. */
export const hasDrag = (scene: LabScene) =>
  scene.airDensity > 0 || scene.linearDrag > 0;
/** The force acting on a body over [t, t + h), averaged over the step so the impulse is exact. */
export function forceOver(body: Launch, t: number, h: number) {
  const force = body.force;
  if (!force) return { x: 0, y: 0 };
  const overlap = Math.max(
    0,
    Math.min(force.end, t + h) - Math.max(force.start, t),
  );
  if (overlap === 0) return { x: 0, y: 0 };
  const share = overlap / h;
  return { x: force.x * share, y: force.y * share };
}

/** Rolling-inertia factor k in I = k m r² about the rolling axis; undefined for a block. */
export const rollingFactor = (body: Body) =>
  body.kind === "ball" ? 2 / 5 : body.kind === "cylinder" ? 1 / 2 : undefined;

/**
 * The body made of a library material: its friction and restitution. The mass stays as
 * set, since a solid lab-sized steel part would outweigh the mass limit; `densityMass`
 * gives the mass the density implies.
 */
export function withMaterial<T extends Body>(body: T, name: MaterialName): T {
  const { friction, restitution } = MATERIALS[name];
  return { ...body, material: name, friction, restitution };
}

/** The mass, in kg, a solid body of the material's density would have. */
export const densityMass = (body: Body, name: MaterialName) =>
  MATERIALS[name].density * bodyVolume(body);

/** The friction coefficient a body meets on a surface of coefficient `mu`. */
export const contactFriction = (body: Surface, mu: number) =>
  body.friction === undefined ? mu : Math.min(mu, body.friction);

/** Launch speed and elevation (degrees above +x) from a body's launch velocity. */
export const launchOf = (body: Launch) => ({
  speed: Math.hypot(body.vx, body.vy),
  elevation: (Math.atan2(body.vy, body.vx) * 180) / Math.PI,
});

/** Launch velocity components for a speed and an elevation in degrees, to 1 mm/s. */
export function launchVelocity(speed: number, elevation: number): Launch {
  const angle = radians(elevation);
  const round = (value: number) => Math.round(value * 1000) / 1000 || 0;
  return {
    vx: round(speed * Math.cos(angle)),
    vy: round(speed * Math.sin(angle)),
  };
}

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
  kind: "cylinder",
  id: string,
  x?: number,
  z?: number,
): Cylinder;
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
        vy: 0,
        restitution: 0,
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
      return {
        ...placement,
        kind,
        y: 0.5,
        radius: 0.5,
        mass: 2,
        vx: 0,
        vy: 0,
        restitution: 0,
      };
    case "cylinder":
      return {
        ...placement,
        kind,
        y: 0.4,
        radius: 0.4,
        length: 1,
        mass: 2,
        vx: 0,
        vy: 0,
        restitution: 0,
      };
    case "pendulum":
      return {
        ...placement,
        kind,
        pivotHeight: 5,
        length: 3,
        mass: 1,
        bobRadius: 0.2,
        angle: 20,
        link: "rod",
        rodMass: 0,
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

/**
 * Gap left between a placed body and the ramp surface, in metres. A placed body starts in
 * contact, so it slides from rest instead of falling onto the ramp first.
 */
export const RAMP_CLEARANCE = 0;

/**
 * The gap that earlier scenes used, in metres. Their bodies fell about 0.05 s onto the ramp
 * before sliding; they are still recognised as placed on it.
 */
export const LEGACY_RAMP_CLEARANCE = 0.015;

export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const rampHeight = (ramp: Ramp) =>
  ramp.length * Math.tan(radians(ramp.angle));

/** Places a body at rest on a ramp; `fraction` runs from the top (0) to the foot (1). */
export function blockOnRamp<T extends Body>(
  block: T,
  ramp: Ramp,
  fraction = 0.23,
  lateral = 0,
  gap: number = RAMP_CLEARANCE,
): T {
  const tilt = radians(ramp.angle);
  const surfaceX = ramp.length * (fraction - 0.5);
  const clearance = bodyHalf(block) + gap;
  return {
    ...block,
    x: ramp.x + surfaceX + clearance * Math.sin(tilt),
    y:
      (ramp.length / 2 - surfaceX) * Math.tan(tilt) +
      clearance * Math.cos(tilt),
    z: ramp.z + lateral,
    ...(block.kind === "block" ? { rotation: -ramp.angle } : {}),
    vx: 0,
    vy: 0,
  };
}

/**
 * Returns an on-surface starting position expressed relative to the ramp, for a body placed
 * in contact or with the legacy gap.
 */
export function rampPlacement(block: Body, ramp: Ramp) {
  if (block.kind === "block" && block.rotation !== -ramp.angle) return;
  if (block.vx !== 0 || block.vy !== 0) return;
  for (const gap of [RAMP_CLEARANCE, LEGACY_RAMP_CLEARANCE]) {
    const normalOffset =
      (bodyHalf(block) + gap) * Math.sin(radians(ramp.angle));
    const fraction = (block.x - ramp.x - normalOffset) / ramp.length + 0.5;
    const lateral = block.z - ramp.z;
    if (fraction <= 0 || fraction >= 1 || Math.abs(lateral) > ramp.width / 2)
      continue;
    const expected = blockOnRamp(block, ramp, fraction, lateral, gap);
    if (Math.abs(block.y - expected.y) < 1e-6) return { fraction, lateral };
  }
}

export function findRampPlacement<T extends Body>(
  block: T,
  ramp: Ramp,
  objects: LabObject[],
): T | undefined {
  const half = bodyHalf(block);
  if (bodyDepth(block) > ramp.width) return;
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

export type PartMove = { x: number; y: number; z: number };

/** Applies a world-space translation to the starting scene, including bodies on a ramp. */
export function movePart(
  scene: LabScene,
  id: string,
  offset: PartMove,
): LabScene {
  const object = scene.objects.find((part) => part.id === id);
  if (!object || ![offset.x, offset.y, offset.z].every(Number.isFinite))
    return scene;
  const moving =
    object.kind === "ramp"
      ? [
          object,
          ...scene.objects.filter(
            (part) => isBody(part) && rampPlacement(part, object),
          ),
        ]
      : [object];
  const [min, max] = limits.position;
  const clamp = (value: number, lower: number, upper: number) =>
    Math.max(lower, Math.min(upper, value));
  const bounded = (axis: "x" | "z") => {
    const values = moving.map((part) => part[axis]);
    return clamp(
      offset[axis],
      min - Math.min(...values),
      max - Math.max(...values),
    );
  };
  const x = object.x + bounded("x");
  const z = object.z + bounded("z");
  const planarMove = x !== object.x || z !== object.z;
  let next: LabObject;
  if (isBody(object)) {
    const y = clamp(object.y + offset.y, limits.height[0], limits.height[1]);
    if (!planarMove && y === object.y) return scene;
    next = { ...object, x, y, z };
  } else if (object.kind === "pendulum" || object.kind === "spring") {
    const height =
      object.kind === "pendulum" ? object.pivotHeight : object.anchorHeight;
    const floorClearance =
      object.kind === "pendulum"
        ? object.length + object.bobRadius
        : object.restLength +
          springSag(object, scene.gravity) +
          object.size +
          Math.abs(object.offset);
    const minimum = Math.max(
      limits.pivotHeight[0],
      floorClearance + 0.050000001,
    );
    // Imported scenes may intentionally contain an oscillator that touches the floor.
    const moved =
      offset.y === 0
        ? height
        : clamp(
            height + offset.y,
            Math.min(height, minimum),
            limits.pivotHeight[1],
          );
    if (!planarMove && moved === height) return scene;
    next =
      object.kind === "pendulum"
        ? { ...object, x, z, pivotHeight: moved }
        : { ...object, x, z, anchorHeight: moved };
  } else {
    if (!planarMove) return scene;
    next = { ...object, x, z };
  }
  return replaceObject(scene, next);
}

export function makeScene(preset: Preset): LabScene {
  const scene: LabScene = {
    version: SCENE_VERSION,
    name: presetNames[preset],
    gravity: 9.81,
    floorFriction: 0.35,
    airDensity: 0,
    linearDrag: 0,
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
  } else if (preset === "compound") {
    // A 2 kg rod carrying a 1 kg bob, which shortens the period, inside the small-angle range.
    scene.objects = [
      { ...makeObject("pendulum", "pendulum-1"), angle: 8, rodMass: 2 },
    ];
  } else if (preset === "rope") {
    // Released above the pivot, the bob falls straight down until the rope pulls taut.
    scene.objects = [
      { ...makeObject("pendulum", "pendulum-1"), angle: 120, link: "rope" },
    ];
  } else if (preset === "spring") {
    scene.objects = [makeObject("spring", "spring-1")];
  } else if (preset === "launcher") {
    // A steel ball launched from the floor at 10 m/s, 45° above +x.
    const ball = { ...makeObject("ball", "ball-1", -6), radius: 0.2, y: 0.2 };
    scene.objects = [
      { ...withMaterial(ball, "steel"), ...launchVelocity(10, 45) },
    ];
  } else if (preset === "bounce") {
    const ball = { ...makeObject("ball", "ball-1"), radius: 0.2, y: 2.2 };
    scene.objects = [withMaterial(ball, "rubber")];
  } else if (preset === "push") {
    // 10 N for one second against μ = 0.35: the block speeds up, then slides to rest.
    scene.objects = [
      {
        ...makeObject("block", "block-1", -6),
        y: 0.5,
        force: { x: 10, y: 0, start: 0, end: 1 },
      },
    ];
  } else if (preset === "drag") {
    // A light ball dropped 15 m through sea-level air nears its terminal speed.
    scene.airDensity = 1.2;
    scene.objects = [
      { ...makeObject("ball", "ball-1"), radius: 0.3, mass: 0.5, y: 15.3 },
    ];
  } else if (preset === "collision") {
    // Equal balls on a frictionless floor slide without spinning and meet centre to
    // centre, so the impact is one-dimensional and both speeds stay constant after it.
    scene.floorFriction = 0;
    const ball = (id: string, x: number, mass: number) =>
      withMaterial(
        { ...makeObject("ball", id, x), radius: 0.3, y: 0.3, mass },
        "steel",
      );
    scene.objects = [{ ...ball("ball-1", -4, 2), vx: 3 }, ball("ball-2", 0, 1)];
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
  label = key,
): number {
  const value = input[key];
  const [min, max] = range;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be a number between ${min} and ${max}.`);
  return value;
}

function optional(
  input: Record<string, unknown>,
  key: string,
  range: readonly [number, number, number],
  fallback: number,
): number {
  return input[key] === undefined ? fallback : numeric(input, key, range);
}

/** Restitution, optional friction and material name; absent fields keep lab/1 behaviour. */
function parseSurface(input: Record<string, unknown>): Surface {
  const { material } = input;
  if (
    material !== undefined &&
    !(typeof material === "string" && Object.hasOwn(MATERIALS, material))
  )
    throw new Error(`material must be one of ${materialNames.join(", ")}.`);
  const surface: Surface = {
    restitution: optional(input, "restitution", limits.restitution, 0),
  };
  if (material !== undefined) surface.material = material as MaterialName;
  if (input.friction !== undefined)
    surface.friction = numeric(input, "friction", limits.friction);
  if (input.dragCoefficient !== undefined)
    surface.dragCoefficient = numeric(
      input,
      "dragCoefficient",
      limits.dragCoefficient,
    );
  return surface;
}

/** A pendulum's link; scenes saved before links hang their bob on a massless rod. */
function parseLink(input: Record<string, unknown>) {
  const link = input.link ?? "rod";
  if (!PENDULUM_LINKS.includes(link as PendulumLink))
    throw new Error(`link must be one of ${PENDULUM_LINKS.join(", ")}.`);
  const rodMass = optional(input, "rodMass", limits.rodMass, 0);
  if (link === "rope" && rodMass > 0)
    throw new Error("A rope has no mass; set rodMass to 0 or use a rod.");
  return { link: link as PendulumLink, rodMass };
}

/** Launch velocity and the optional applied force of a free body. */
function parseLaunch(input: Record<string, unknown>): Launch {
  const launch: Launch = {
    vx: numeric(input, "vx", limits.velocity),
    vy: optional(input, "vy", limits.velocity, 0),
  };
  if (input.force === undefined) return launch;
  const force = record(input.force, "force");
  const parsed = {
    x: numeric(force, "x", limits.force, "force.x"),
    y: numeric(force, "y", limits.force, "force.y"),
    start: numeric(force, "start", limits.forceTime, "force.start"),
    end: numeric(force, "end", limits.forceTime, "force.end"),
  };
  if (parsed.end <= parsed.start)
    throw new Error("A force must end after it starts.");
  return { ...launch, force: parsed };
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
        ...parseLaunch(object),
        ...parseSurface(object),
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
        wheelMass: optional(object, "wheelMass", limits.wheelMass, 0),
      };
    case "ball":
      return {
        ...placement,
        kind,
        y: numeric(object, "y", limits.height),
        radius: numeric(object, "radius", limits.radius),
        mass: numeric(object, "mass", limits.mass),
        ...parseLaunch(object),
        ...parseSurface(object),
      };
    case "cylinder":
      return {
        ...placement,
        kind,
        y: numeric(object, "y", limits.height),
        radius: numeric(object, "radius", limits.radius),
        length: numeric(object, "length", limits.cylinderLength),
        mass: numeric(object, "mass", limits.mass),
        ...parseLaunch(object),
        ...parseSurface(object),
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
        ...parseLink(object),
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
        "Supported objects are blocks, balls, cylinders, ramps, pulleys, pendulums and springs.",
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
      `Balls, cylinders, pendulums and springs need scene version ${SCENE_VERSION}.`,
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
    // Optional, so scenes saved before air drag stay in vacuum.
    airDensity: optional(scene, "airDensity", limits.airDensity, 0),
    linearDrag: optional(scene, "linearDrag", limits.linearDrag, 0),
    objects,
  };
}
