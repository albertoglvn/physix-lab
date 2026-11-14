import type {
  Collider,
  ColliderDesc,
  RigidBody,
} from "@dimforge/rapier3d-compat";
import {
  bodyDepth,
  bodyHalf,
  BUMPER_DEPTH,
  BUMPER_HEIGHT,
  BUMPER_WALL,
  bumperDirection,
  bumperFace,
  dragCoefficients,
  forceOver,
  hasDrag,
  isBody,
  parseScene,
  radians,
  rampHeight,
  springEquilibrium,
  type Body,
  type Bumper,
  type LabObject,
  type Pendulum,
  type Pulley,
  type Ramp,
  type Spring,
} from "./scene.ts";

export const TIME_STEP = 1 / 120;
export const SOLVER_ITERATIONS = 8;
/**
 * Rapier integrates each step in SOLVER_ITERATIONS substeps, so a force held over the step
 * moves a body by h²(N+1)/(2N)·F/m. Evaluating the spring at y + h·v·(N−1)/(2N) makes the
 * undamped step map area-preserving, so the oscillation neither grows nor decays.
 */
export const SPRING_LEAD = (SOLVER_ITERATIONS - 1) / (2 * SOLVER_ITERATIONS);
/** Largest step a caller may request; convergence checks only refine below the default. */
export const MAX_TIME_STEP = 1 / 30;
export const PULLEY_HEIGHT = 4;
export const PULLEY_RADIUS = 0.58;
/** Starting centre height of both weights. */
export const PULLEY_WEIGHT_HEIGHT = 1.8;
/** Width (x and z) and height of each weight, in metres. */
export const PULLEY_WEIGHT_WIDTH = 0.5;
export const PULLEY_WEIGHT_TALL = 0.54;
/** Height of the frame's base plate, which a descending weight lands on. */
export const PULLEY_BASE_HEIGHT = 0.16;
/** Rope travel at which the descending weight lands on the base. */
export const PULLEY_TRAVEL =
  PULLEY_WEIGHT_HEIGHT - PULLEY_WEIGHT_TALL / 2 - PULLEY_BASE_HEIGHT;
/** Height at which a rising weight's inner top edge meets the wheel. */
export const PULLEY_CEILING =
  PULLEY_HEIGHT -
  Math.sqrt(
    PULLEY_RADIUS ** 2 - (PULLEY_RADIUS - PULLEY_WEIGHT_WIDTH / 2) ** 2,
  );

export type Vec3 = { x: number; y: number; z: number };
type Rotation = Vec3 & { w: number };
export type BlockState = {
  position: Vec3;
  rotation: Rotation;
  velocity: Vec3;
  /** Angular velocity in rad/s about the world axes. */
  angularVelocity?: Vec3;
};
/** One weight's centre height and vertical velocity. */
export type WeightState = { y: number; vy: number };
export type PulleyState = {
  /** Rope travel, positive when the right weight has gone down: the mean of both sides. */
  displacement: number;
  /** Rope speed, (v₁ − v₂)/2 with v up, positive when the right weight descends. */
  speed: number;
  /** Change in rope speed over the latest step; before the first step, the planned value. */
  acceleration: number;
  /** Mean rope force on the left weight over the latest step, in newtons (0 when slack). */
  tension: number;
  /** Mean rope force on the right weight over the latest step. */
  rightTension: number;
  left: WeightState;
  right: WeightState;
  /** Rim speed of the wheel in m/s, positive when it turns to lower the right weight. */
  wheelSpeed: number;
  /** Wheel rotation since release in radians, positive lowering the right weight. */
  wheelAngle: number;
  taut: boolean;
  /** A weight touches the base or the wheel. */
  stopped: boolean;
};

/**
 * The ideal Atwood machine with a wheel that is a uniform disc (I = M R² / 2): rope
 * acceleration a (positive lowers the right weight) and the rope tension on each side.
 */
export function atwood(pulley: Pulley, gravity: number) {
  const { leftMass: m1, rightMass: m2 } = pulley;
  const wheel = pulley.wheelMass / 2;
  const acceleration = (gravity * (m2 - m1)) / (m1 + m2 + wheel);
  return {
    acceleration,
    leftTension: m1 * (gravity + acceleration),
    rightTension: m2 * (gravity - acceleration),
    /** I / R², the wheel's mass as felt along the rope. */
    wheel,
  };
}

/** Rope travel the right weight can make, down or up, before a weight meets a stop. */
export const PULLEY_CLEARANCE = Math.min(
  PULLEY_TRAVEL,
  PULLEY_CEILING - PULLEY_WEIGHT_TALL / 2 - PULLEY_WEIGHT_HEIGHT,
);

/**
 * An Atwood machine whose right weight is tied to the base by a spring of stiffness k.
 * Released from rest, the rope travel s oscillates about s_eq = (m₂ − m₁) g / k with
 * ω = √(k / M), where M = m₁ + m₂ + I/R², so it reaches 2 s_eq.
 */
export function springAtwood(pulley: Pulley, gravity: number) {
  const { wheel } = atwood(pulley, gravity);
  const mass = pulley.leftMass + pulley.rightMass + wheel;
  const k = pulley.springStiffness;
  const equilibrium = ((pulley.rightMass - pulley.leftMass) * gravity) / k;
  const omega = Math.sqrt(k / mass);
  return {
    equilibrium,
    omega,
    period: (2 * Math.PI) / omega,
    /** Largest travel from release, signed like the travel. */
    reach: 2 * equilibrium,
    mass,
  };
}

/** Lowest centre height of a weight: resting on the base plate. */
export const WEIGHT_LOW = PULLEY_BASE_HEIGHT + PULLEY_WEIGHT_TALL / 2;
/** Highest centre height of a weight: its inner top edge against the wheel. */
export const WEIGHT_HIGH = PULLEY_CEILING - PULLEY_WEIGHT_TALL / 2;
/** Sum of both weight heights while the rope is taut. */
const ROPE_SUM = 2 * PULLEY_WEIGHT_HEIGHT;
/** Rope lengthening, in metres, below which the rope still counts as taut. */
const ROPE_SLACK = 1e-9;
const atLow = (y: number) => y <= WEIGHT_LOW + ROPE_SLACK;
const atHigh = (y: number) => y >= WEIGHT_HIGH - ROPE_SLACK;

/** A pulley at release: both weights at rest at the starting height, the rope taut. */
export function initialPulleyState(
  pulley: Pulley,
  gravity: number,
): PulleyState {
  const ideal = atwood(pulley, gravity);
  const still = { y: PULLEY_WEIGHT_HEIGHT, vy: 0 };
  return {
    displacement: 0,
    speed: 0,
    acceleration: ideal.acceleration,
    tension: ideal.leftTension,
    rightTension: ideal.rightTension,
    left: still,
    right: still,
    wheelSpeed: 0,
    wheelAngle: 0,
    taut: true,
    stopped: false,
  };
}

/** Upward spring force on the right weight, zero at the release height. */
export const pulleySpringForce = (pulley: Pulley, rightY: number) =>
  pulley.springStiffness * (PULLEY_WEIGHT_HEIGHT - rightY);

/**
 * Exact step of y'' = −ω² (y − centre) over `h`: harmonic motion about `centre`.
 */
function harmonic(
  y: number,
  v: number,
  centre: number,
  omega: number,
  h: number,
): [number, number] {
  const c = Math.cos(omega * h);
  const s = Math.sin(omega * h);
  const offset = y - centre;
  return [centre + offset * c + (v / omega) * s, -offset * omega * s + v * c];
}

/**
 * Advances an Atwood machine by one step of `h` seconds. While the rope is taut both
 * weights move with the Atwood acceleration, integrated exactly; with a spring on the
 * right weight that motion is harmonic, also integrated exactly. A slack rope lets each
 * weight fall freely while the wheel spins on. Landing on the base and meeting the wheel
 * are inelastic stops. A rope pulled tight again takes an inelastic jerk that leaves both
 * weights and the wheel rim at one speed, conserving momentum along the rope. The
 * reported tensions are the mean rope force on each weight over the step.
 */
export function stepAtwood(
  pulley: Pulley,
  gravity: number,
  state: PulleyState,
  h: number,
): PulleyState {
  const { leftMass: m1, rightMass: m2 } = pulley;
  const ideal = atwood(pulley, gravity);
  const g = gravity;
  let { y: y1, vy: v1 } = state.left;
  let { y: y2, vy: v2 } = state.right;
  let wheel = state.wheelSpeed;
  let t1 = 0;
  let t2 = 0;
  const k = pulley.springStiffness;
  const mass = m1 + m2 + ideal.wheel;
  // Rope travel lowering the right weight, which the spring resists.
  const sprung = PULLEY_WEIGHT_HEIGHT - y2;
  const a = (g * (m2 - m1) - k * sprung) / mass;
  // A spring can pull the right weight down faster than the rope allows; the rope then
  // goes slack instead of pushing.
  const pulls =
    m1 * (g + a) >= -ROPE_SLACK && m2 * (g - a) - k * sprung >= -ROPE_SLACK;
  const taut =
    y1 + y2 - ROPE_SUM <= ROPE_SLACK && v1 + v2 <= ROPE_SLACK && pulls;
  if (taut) {
    const u = (v1 - v2) / 2;
    const resting = Math.abs(u) <= ROPE_SLACK;
    if (resting && ((a > 0 && atLow(y2)) || (a < 0 && atHigh(y2)))) {
      // The right weight holds the system; the rope carries the left weight.
      v1 = v2 = wheel = 0;
      t1 = t2 = m1 * g;
    } else if (resting && ((a > 0 && atHigh(y1)) || (a < 0 && atLow(y1)))) {
      v1 = v2 = wheel = 0;
      t1 = t2 = m2 * g;
    } else if (k > 0) {
      const { equilibrium, omega } = springAtwood(pulley, g);
      const [reached, next] = harmonic(sprung, u, equilibrium, omega, h);
      const travel = reached - sprung;
      y1 += travel;
      y2 -= travel;
      v1 = next;
      v2 = -next;
      wheel = next;
      // Mean rope forces over the step, from the mean acceleration and spring force.
      const mean = (next - u) / h;
      t1 = m1 * (g + mean);
      t2 = m2 * (g - mean) - (k * (sprung + reached)) / 2;
    } else {
      const travel = u * h + (a * h * h) / 2;
      y1 += travel;
      y2 -= travel;
      v1 = u + a * h;
      v2 = -v1;
      wheel = v1;
      t1 = ideal.leftTension;
      t2 = ideal.rightTension;
    }
  } else {
    y1 += v1 * h - (g * h * h) / 2;
    v1 -= g * h;
    if (k > 0) {
      // The spring holds the right weight about the height where it balances gravity.
      [y2, v2] = harmonic(
        y2,
        v2,
        PULLEY_WEIGHT_HEIGHT - (m2 * g) / k,
        Math.sqrt(k / m2),
        h,
      );
    } else {
      y2 += v2 * h - (g * h * h) / 2;
      v2 -= g * h;
    }
  }

  // Inelastic stops. On a taut rope, a partner slower than one step of gravity comes to
  // rest with the weight that stopped, so a landed system settles instead of chattering at
  // the scale of g h².
  const stop = (y: number, v: number): [number, number, boolean] => {
    if (y < WEIGHT_LOW) return [WEIGHT_LOW, Math.max(v, 0), true];
    if (y > WEIGHT_HIGH) return [WEIGHT_HIGH, Math.min(v, 0), true];
    return [y, v, false];
  };
  const [stopY1, stopV1, hit1] = stop(y1, v1);
  const [stopY2, stopV2, hit2] = stop(y2, v2);
  y1 = stopY1;
  v1 = stopV1;
  y2 = stopY2;
  v2 = stopV2;
  if (taut && (hit1 || hit2)) {
    const partner = hit2 ? v1 : v2;
    if (Math.abs(partner) <= g * h) {
      // Settles on a taut rope: the partner keeps the rope length and stops too.
      if (hit2 && !hit1) y1 = ROPE_SUM - y2;
      if (hit1 && !hit2) y2 = ROPE_SUM - y1;
      v1 = v2 = wheel = 0;
    }
  }

  const gap = y1 + y2 - ROPE_SUM;
  if (gap < -ROPE_SLACK) {
    let u = (m1 * v1 - m2 * v2 + ideal.wheel * wheel) / (m1 + m2 + ideal.wheel);
    // A stop takes the jerk instead when the shared motion would drive a weight into it.
    if (
      (u > 0 && (atLow(y2) || atHigh(y1))) ||
      (u < 0 && (atLow(y1) || atHigh(y2)))
    )
      u = 0;
    t1 += (m1 * (u - v1)) / h;
    t2 += (m2 * (-u - v2)) / h;
    v1 = u;
    v2 = -u;
    wheel = u;
    const share = atLow(y2) ? 1 : atLow(y1) ? 0 : m2 / (m1 + m2);
    y1 -= gap * share;
    y2 -= gap * (1 - share);
  }

  const speed = (v1 - v2) / 2;
  return {
    displacement: (y1 - y2) / 2,
    speed,
    acceleration: (speed - state.speed) / h,
    tension: t1,
    rightTension: t2,
    left: { y: y1, vy: v1 },
    right: { y: y2, vy: v2 },
    wheelSpeed: wheel,
    wheelAngle:
      state.wheelAngle + ((state.wheelSpeed + wheel) / 2) * (h / PULLEY_RADIUS),
    taut: y1 + y2 - ROPE_SUM <= ROPE_SLACK,
    stopped: atLow(y1) || atLow(y2) || atHigh(y1) || atHigh(y2),
  };
}

export function rampVertices(ramp: Ramp): number[] {
  const half = ramp.length / 2;
  const depth = ramp.width / 2;
  const height = rampHeight(ramp);
  return [
    -half,
    0,
    depth,
    half,
    0,
    depth,
    -half,
    height,
    depth,
    -half,
    0,
    -depth,
    half,
    0,
    -depth,
    -half,
    height,
    -depth,
  ];
}

export type BodyPart = Exclude<LabObject, Ramp | Pulley | Bumper>;

/**
 * How far a free body centred at `p` has pushed its leading face past a bumper's pad
 * plane, in metres, or 0. The body must be on the pad's side of the wall, below the top
 * of the bumper and overlapping it along z. A block is taken upright.
 */
export function bumperCompression(bumper: Bumper, body: Body, p: Vec3) {
  const direction = bumperDirection(bumper);
  const half = bodyHalf(body);
  if (direction * (p.x - bumper.x) <= 0) return 0;
  if (p.y - half >= BUMPER_HEIGHT) return 0;
  if (Math.abs(p.z - bumper.z) >= (BUMPER_DEPTH + bodyDepth(body)) / 2)
    return 0;
  return Math.max(0, direction * (bumperFace(bumper) - p.x) + half);
}

/**
 * The bumper's push on a body along the pad's facing, k d + c ḋ, from the compression d
 * and the body's x velocity. A pad only pushes, so the result is never negative.
 */
export function bumperPush(bumper: Bumper, compression: number, vx: number) {
  if (compression <= 0) return 0;
  const outward = bumperDirection(bumper) * vx;
  return Math.max(0, bumper.stiffness * compression - bumper.damping * outward);
}

/**
 * A bumper's state: its largest compression, its total push and its elastic energy. The
 * energy is ½k·d₀·d₁, with the compression before and after the last step: the form the
 * impulse-then-move step conserves exactly, so kinetic plus elastic energy stays flat
 * through a contact instead of wobbling by about h·v/d.
 */
export type BumperState = {
  compression: number;
  force: number;
  elastic: number;
};

const still = { x: 0, y: 0, z: 0 };
const upright = { x: 0, y: 0, z: 0, w: 1 };

/** Where a pendulum's bob centre sits at swing angle `theta` (radians). */
export const bobPosition = (pendulum: Pendulum, theta: number): Vec3 => ({
  x: pendulum.x + pendulum.length * Math.sin(theta),
  y: pendulum.pivotHeight - pendulum.length * Math.cos(theta),
  z: pendulum.z,
});

/** Tension along a spring and dashpot from the cube's top height and vertical velocity. */
export function springForce(spring: Spring, top: number, vy: number) {
  return (
    spring.stiffness * (spring.anchorHeight - top - spring.restLength) -
    spring.damping * vy
  );
}

/**
 * The force held on a spring cube over one step. The spring is read at the lead position
 * (see SPRING_LEAD); the damper at the mean of the step's start and end velocities, which
 * depends on the force itself: F = (Fₛ − c (v − h g / 2)) / (1 + c h / (2m)).
 */
export function springStepForce(
  spring: Spring,
  y: number,
  vy: number,
  timeStep: number,
  gravity: number,
) {
  const top = y + spring.size / 2 + SPRING_LEAD * timeStep * vy;
  const elastic = springForce(spring, top, 0);
  const c = spring.damping;
  return (
    (elastic - c * (vy - (timeStep * gravity) / 2)) /
    (1 + (c * timeStep) / (2 * spring.mass))
  );
}

/**
 * The rigid body a part starts as: a block, ball, pendulum bob or spring cube. A spring's
 * release height depends on gravity through its equilibrium.
 */
export function initialBlockState(part: BodyPart, gravity = 9.81): BlockState {
  if (part.kind === "block") {
    const halfAngle = radians(part.rotation) / 2;
    return {
      position: { x: part.x, y: part.y, z: part.z },
      rotation: { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) },
      velocity: { x: part.vx, y: part.vy, z: 0 },
    };
  }
  if (part.kind === "ball" || part.kind === "cylinder")
    return {
      position: { x: part.x, y: part.y, z: part.z },
      rotation: upright,
      velocity: { x: part.vx, y: part.vy, z: 0 },
    };
  if (part.kind === "pendulum")
    return {
      position: bobPosition(part, radians(part.angle)),
      rotation: upright,
      velocity: still,
    };
  return {
    position: {
      x: part.x,
      y: springEquilibrium(part, gravity) + part.offset,
      z: part.z,
    },
    rotation: upright,
    velocity: still,
  };
}

/**
 * Friction of a body without its own coefficient. Contacts take the smaller coefficient of
 * the pair, so such a body leaves the surface's coefficient in charge (up to the limit, 2).
 */
export const NEUTRAL_FRICTION = 2;

/**
 * The force to hold over one step so that, with the engine's update v + h (a + f/m), the
 * velocity follows the exact solution of v' = a − k v across the step. `a` is gravity plus
 * any applied force per unit mass and k = (b + c |v|)/m. |v| is taken at the step's
 * predicted midpoint, so the terminal speed √(m g / c) is exact and transients are second
 * order in the step.
 */
export function dragStepForce(
  velocity: Vec3,
  accel: Vec3,
  mass: number,
  linear: number,
  quadratic: number,
  timeStep: number,
): Vec3 {
  const { x, y, z } = velocity;
  const speed = Math.hypot(x, y, z);
  if (linear === 0 && quadratic === 0) return { x: 0, y: 0, z: 0 };
  const k0 = (linear + quadratic * speed) / mass;
  const half = timeStep / 2;
  const mid = Math.hypot(
    x + (accel.x - k0 * x) * half,
    y + (accel.y - k0 * y) * half,
    z + (accel.z - k0 * z) * half,
  );
  const k = (linear + quadratic * mid) / mass;
  if (k === 0) return { x: 0, y: 0, z: 0 };
  const kh = k * timeStep;
  const decay = Math.exp(-kh);
  // (1 − e^(−kh))/k, written to keep its precision when kh is small.
  const phi = -Math.expm1(-kh) / k;
  const axis = (v: number, a: number) =>
    (mass * (v * (decay - 1) + a * (phi - timeStep))) / timeStep;
  return {
    x: axis(x, accel.x),
    y: axis(y, accel.y),
    z: axis(z, accel.z),
  };
}
/** A quarter turn about x: lays Rapier's y-axis cylinders along z. */
const ALONG_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

type Rapier = typeof import("@dimforge/rapier3d-compat").default;

type Rope = {
  pulley: Pulley;
  left: RigidBody;
  right: RigidBody;
  state: PulleyState;
};
let initializing: Promise<Rapier> | undefined;

export type SimulationOptions = {
  /** Fixed step in seconds, from 0 to 1/30 s. Defaults to 1/120 s. */
  timeStep?: number;
};

/**
 * Contact force on a body over the last step, in newtons: its size, its part along the
 * contact normal and its part across it.
 */
export type ContactForce = { normal: number; friction: number; total: number };

export type Simulation = {
  readonly rapierVersion: string;
  readonly timeStep: number;
  readonly solverIterations: number;
  readonly time: number;
  step: (count?: number) => void;
  /**
   * The rigid body of a block, ball, pendulum bob or spring cube. The position and velocity
   * are those of the part's centre, the bob's for a pendulum with a massive rod.
   */
  block: (id: string) => BlockState | undefined;
  /**
   * The contact force on a free body over the last step: m Δv / h less gravity and the
   * applied and drag forces, split along the mean normal of its contacts.
   */
  contact: (id: string) => ContactForce | undefined;
  /**
   * The force a pendulum's rod or rope exerted on the swinging body over the last step,
   * m (Δv/h) − m g for the bob and rod together; undefined before the first step.
   */
  linkForce: (id: string) => Vec3 | undefined;
  pulley: (id: string) => PulleyState | undefined;
  /** What a bumper's spring holds at the current positions; undefined for other ids. */
  bumper: (id: string) => BumperState | undefined;
  dispose: () => void;
};

/** Uses the same fixed-step simulation in the browser and in headless callers. */
export async function createSimulation(
  input: unknown,
  { timeStep = TIME_STEP }: SimulationOptions = {},
): Promise<Simulation> {
  const scene = parseScene(input);
  if (!Number.isFinite(timeStep) || timeStep <= 0 || timeStep > MAX_TIME_STEP)
    throw new RangeError(
      "The time step must be greater than 0 and at most 1/30 s.",
    );
  initializing ??= import("@dimforge/rapier3d-compat")
    .then(async ({ default: rapier }) => {
      await rapier.init();
      return rapier;
    })
    .catch((error: unknown) => {
      initializing = undefined;
      throw error;
    });
  const rapier = await initializing;
  const world = new rapier.World({ x: 0, y: -scene.gravity, z: 0 });
  const blocks = new Map<string, RigidBody>();
  const pulleys = new Map<string, Rope>();
  const springs: { spring: Spring; body: RigidBody }[] = [];
  const bumpers = new Map<string, Bumper>();
  /** Every free body, which a bumper may push. */
  const freeBodies: { part: Body; body: RigidBody }[] = [];
  /**
   * Free bodies with their collider, the force this code added in the step (applied and
   * drag) and, after the step, the contact force read from the change in momentum.
   */
  const touching = new Map<
    string,
    {
      collider: Collider;
      body: RigidBody;
      mass: number;
      added: Vec3;
      before?: Vec3;
      force?: Vec3;
    }
  >();
  /** Pendulum bodies with their total mass, and the link force of the last step. */
  const swinging = new Map<
    string,
    { body: RigidBody; mass: number; before?: Vec3; force?: Vec3 }
  >();
  /** Free bodies under an applied force or air drag, with their drag coefficients. */
  const driven: {
    part: Body;
    body: RigidBody;
    linear: number;
    quadratic: number;
  }[] = [];
  let ticks = 0;
  let disposed = false;

  /**
   * Contacts take the smaller friction coefficient and the larger restitution of the two
   * colliders. Surfaces (floor, ramps) have no restitution, so a body's own sets its bounce.
   */
  const surface = (desc: ColliderDesc, coefficient: number, restitution = 0) =>
    desc
      .setFriction(coefficient)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(restitution)
      .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max);

  function shape(part: BodyPart) {
    if (part.kind === "ball") return rapier.ColliderDesc.ball(part.radius);
    if (part.kind === "cylinder")
      return rapier.ColliderDesc.cylinder(
        part.length / 2,
        part.radius,
      ).setRotation(ALONG_Z);
    if (part.kind === "pendulum")
      return rapier.ColliderDesc.ball(part.bobRadius);
    const half = part.size / 2;
    return rapier.ColliderDesc.cuboid(half, half, half);
  }

  /** The frame (base, upright and wheel) as fixed colliders, and both weights. */
  function atwoodMachine(pulley: Pulley): Rope {
    const { x, z } = pulley;
    const fixed = (desc: ColliderDesc) => world.createCollider(desc);
    fixed(
      rapier.ColliderDesc.cuboid(
        1.025,
        PULLEY_BASE_HEIGHT / 2,
        0.59,
      ).setTranslation(x, PULLEY_BASE_HEIGHT / 2, z),
    );
    fixed(
      rapier.ColliderDesc.cuboid(
        0.075,
        PULLEY_HEIGHT / 2,
        0.075,
      ).setTranslation(x, PULLEY_HEIGHT / 2, z - 0.46),
    );
    // Rapier's cylinder runs along y; a quarter turn about x lays the axle along z.
    fixed(
      rapier.ColliderDesc.cylinder(0.09, PULLEY_RADIUS)
        .setTranslation(x, PULLEY_HEIGHT, z)
        .setRotation(ALONG_Z),
    );
    // Kinematic weights follow the rope model and push other parts out of their way.
    const weight = (side: -1 | 1) => {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
          x + side * PULLEY_RADIUS,
          PULLEY_WEIGHT_HEIGHT,
          z,
        ),
      );
      const half = PULLEY_WEIGHT_WIDTH / 2;
      world.createCollider(
        rapier.ColliderDesc.cuboid(half, PULLEY_WEIGHT_TALL / 2, half),
        body,
      );
      return body;
    };
    return {
      pulley,
      left: weight(-1),
      right: weight(1),
      state: initialPulleyState(pulley, scene.gravity),
    };
  }

  function moveRope(rope: Rope) {
    rope.state = stepAtwood(rope.pulley, scene.gravity, rope.state, timeStep);
    const { x, z } = rope.pulley;
    rope.left.setNextKinematicTranslation({
      x: x - PULLEY_RADIUS,
      y: rope.state.left.y,
      z,
    });
    rope.right.setNextKinematicTranslation({
      x: x + PULLEY_RADIUS,
      y: rope.state.right.y,
      z,
    });
  }

  /**
   * Hangs the bob from a fixed pivot. A rod is a revolute joint about z; its mass, if any,
   * is a collider-free mass at the rod's middle with the inertia M L²/12 of a thin rod, so
   * the body has M L²/3 more about the pivot. A rope is a rope joint between the pivot and
   * the bob's centre.
   */
  function hinge(pendulum: Pendulum, bob: RigidBody) {
    const pivot = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(
        pendulum.x,
        pendulum.pivotHeight,
        pendulum.z,
      ),
    );
    const theta = radians(pendulum.angle);
    const toPivot = {
      x: -pendulum.length * Math.sin(theta),
      y: pendulum.length * Math.cos(theta),
      z: 0,
    };
    if (pendulum.link === "rope") {
      world.createImpulseJoint(
        rapier.JointData.rope(
          pendulum.length,
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ),
        pivot,
        bob,
        true,
      );
      return;
    }
    if (pendulum.rodMass > 0) {
      const inertia = (pendulum.rodMass * pendulum.length ** 2) / 12;
      world.createCollider(
        rapier.ColliderDesc.ball(0.01)
          .setTranslation(toPivot.x / 2, toPivot.y / 2, 0)
          .setCollisionGroups(0)
          .setMassProperties(
            pendulum.rodMass,
            { x: 0, y: 0, z: 0 },
            { x: inertia, y: inertia, z: inertia },
            upright,
          ),
        bob,
      );
    }
    world.createImpulseJoint(
      rapier.JointData.revolute({ x: 0, y: 0, z: 0 }, toPivot, {
        x: 0,
        y: 0,
        z: 1,
      }),
      pivot,
      bob,
      true,
    );
  }

  try {
    world.timestep = timeStep;
    world.numSolverIterations = SOLVER_ITERATIONS;
    world.createCollider(
      surface(
        rapier.ColliderDesc.cuboid(200, 0.25, 200),
        scene.floorFriction,
      ).setTranslation(0, -0.25, 0),
    );

    for (const object of scene.objects) {
      if (object.kind === "ramp") {
        const desc = rapier.ColliderDesc.convexHull(
          new Float32Array(rampVertices(object)),
        );
        if (!desc) throw new Error("Could not construct the ramp collider.");
        world.createCollider(
          surface(desc, object.friction).setTranslation(object.x, 0, object.z),
        );
      } else if (object.kind === "pulley") {
        pulleys.set(object.id, atwoodMachine(object));
      } else if (object.kind === "bumper") {
        // Only the wall collides; the pad acts through the spring force in step().
        world.createCollider(
          surface(
            rapier.ColliderDesc.cuboid(
              BUMPER_WALL / 2,
              BUMPER_HEIGHT / 2,
              BUMPER_DEPTH / 2,
            ),
            NEUTRAL_FRICTION,
          ).setTranslation(object.x, BUMPER_HEIGHT / 2, object.z),
        );
        bumpers.set(object.id, object);
      } else {
        const { position, rotation, velocity } = initialBlockState(
          object,
          scene.gravity,
        );
        const desc = rapier.RigidBodyDesc.dynamic()
          .setTranslation(position.x, position.y, position.z)
          .setRotation(rotation)
          .setLinvel(velocity.x, velocity.y, velocity.z)
          .setCcdEnabled(true);
        if (object.kind === "spring") desc.lockRotations();
        const body = world.createRigidBody(desc);
        if (object.kind === "spring") {
          body.setEnabledTranslations(false, true, false, true);
          springs.push({ spring: object, body });
        }
        const free = isBody(object);
        const collider = world.createCollider(
          surface(
            shape(object),
            free && object.friction !== undefined
              ? object.friction
              : NEUTRAL_FRICTION,
            free ? object.restitution : 0,
          ).setMass(object.mass),
          body,
        );
        if (isBody(object)) freeBodies.push({ part: object, body });
        if (free)
          touching.set(object.id, {
            collider,
            body,
            mass: object.mass,
            added: { x: 0, y: 0, z: 0 },
          });
        if (object.kind === "pendulum") {
          hinge(object, body);
          swinging.set(object.id, {
            body,
            mass: object.mass + (object.link === "rod" ? object.rodMass : 0),
          });
        }
        if (free && (object.force || hasDrag(scene)))
          driven.push({
            part: object,
            body,
            ...dragCoefficients(object, scene),
          });
        blocks.set(object.id, body);
      }
    }
  } catch (error) {
    world.free();
    throw error;
  }

  return {
    rapierVersion: rapier.version(),
    timeStep,
    solverIterations: SOLVER_ITERATIONS,
    get time() {
      return ticks * timeStep;
    },
    step(count = 1) {
      if (disposed) throw new Error("The simulation has been disposed.");
      if (!Number.isSafeInteger(count) || count < 0 || count > 12000)
        throw new RangeError("Step count must be an integer from 0 to 12,000.");
      for (let i = 0; i < count; i++) {
        for (const { spring, body } of springs) {
          const force = springStepForce(
            spring,
            body.translation().y,
            body.linvel().y,
            timeStep,
            scene.gravity,
          );
          body.resetForces(false);
          body.addForce({ x: 0, y: force, z: 0 }, true);
        }
        const t = (ticks + i) * timeStep;
        for (const { part, body, linear, quadratic } of driven) {
          const applied = forceOver(part, t, timeStep);
          const accel = {
            x: applied.x / part.mass,
            y: applied.y / part.mass - scene.gravity,
            z: 0,
          };
          const drag = dragStepForce(
            body.linvel(),
            accel,
            part.mass,
            linear,
            quadratic,
            timeStep,
          );
          const added = {
            x: applied.x + drag.x,
            y: applied.y + drag.y,
            z: drag.z,
          };
          touching.get(part.id)!.added = added;
          body.resetForces(false);
          body.addForce(added, true);
        }
        for (const rope of pulleys.values()) moveRope(rope);
        // Each bumper gives the bodies in its pad one impulse before the step. The step
        // then moves them by h·Δv, a symplectic Euler update, so the spring is read where
        // the body is (no SPRING_LEAD, which corrects a force held over the substeps) and
        // the damper at the step's mean velocity.
        for (const bumper of bumpers.values())
          for (const { part, body } of freeBodies) {
            const p = body.translation();
            const v = body.linvel();
            const d = bumperCompression(bumper, part, p);
            if (d <= 0) continue;
            const push =
              bumperPush(bumper, d, v.x) /
              (1 + (bumper.damping * timeStep) / (2 * part.mass));
            body.applyImpulse(
              { x: bumperDirection(bumper) * push * timeStep, y: 0, z: 0 },
              true,
            );
          }
        for (const part of swinging.values()) part.before = part.body.linvel();
        for (const part of touching.values()) part.before = part.body.linvel();
        world.step();
        // m Δv / h = m g + the forces this code added + the constraint or contact force.
        const reaction = (
          part: { body: RigidBody; mass: number; before?: Vec3 },
          added: Vec3,
        ) => {
          const { x, y, z } = part.body.linvel();
          const before = part.before!;
          return {
            x: (part.mass * (x - before.x)) / timeStep - added.x,
            y:
              part.mass * ((y - before.y) / timeStep + scene.gravity) - added.y,
            z: (part.mass * (z - before.z)) / timeStep - added.z,
          };
        };
        for (const part of swinging.values())
          part.force = reaction(part, { x: 0, y: 0, z: 0 });
        for (const part of touching.values())
          part.force = reaction(part, part.added);
      }
      ticks += count;
    },
    block(id) {
      const body = blocks.get(id);
      if (!body) return;
      const position = body.translation();
      const angularVelocity = body.angvel();
      const com = body.worldCom();
      const velocity = body.linvel();
      // A massive rod moves the centre of mass off the bob: report the bob's own velocity.
      const r = {
        x: position.x - com.x,
        y: position.y - com.y,
        z: position.z - com.z,
      };
      if (r.x || r.y || r.z) {
        const w = angularVelocity;
        velocity.x += w.y * r.z - w.z * r.y;
        velocity.y += w.z * r.x - w.x * r.z;
        velocity.z += w.x * r.y - w.y * r.x;
      }
      return {
        position,
        rotation: body.rotation(),
        velocity,
        angularVelocity,
      };
    },
    contact(id) {
      const part = touching.get(id);
      const force = part?.force;
      if (!part || !force) return;
      // The contact normals of the last step; several touching parts share their mean.
      const sum = { x: 0, y: 0, z: 0 };
      world.contactPairsWith(part.collider, (other) => {
        world.contactPair(part.collider, other, (manifold) => {
          if (manifold.numContacts() === 0) return;
          const n = manifold.normal();
          // Orient each normal along the push, so opposite faces do not cancel.
          const sign =
            n.x * force.x + n.y * force.y + n.z * force.z < 0 ? -1 : 1;
          sum.x += sign * n.x;
          sum.y += sign * n.y;
          sum.z += sign * n.z;
        });
      });
      const length = Math.hypot(sum.x, sum.y, sum.z);
      const size = Math.hypot(force.x, force.y, force.z);
      if (length === 0) return { normal: 0, friction: 0, total: size };
      const normal =
        (force.x * sum.x + force.y * sum.y + force.z * sum.z) / length;
      return {
        normal,
        friction: Math.sqrt(Math.max(0, size * size - normal * normal)),
        total: size,
      };
    },
    linkForce(id) {
      return swinging.get(id)?.force;
    },
    pulley(id) {
      return pulleys.get(id)?.state;
    },
    bumper(id) {
      const bumper = bumpers.get(id);
      if (!bumper) return;
      const state = { compression: 0, force: 0, elastic: 0 };
      for (const { part, body } of freeBodies) {
        const p = body.translation();
        const vx = body.linvel().x;
        const d = bumperCompression(bumper, part, p);
        if (d <= 0) continue;
        // The step moved the body by h·vx, so this was its compression before the step.
        const before = bumperCompression(bumper, part, {
          ...p,
          x: p.x - timeStep * vx,
        });
        state.compression = Math.max(state.compression, d);
        state.force += bumperPush(bumper, d, vx);
        state.elastic += 0.5 * bumper.stiffness * before * d;
      }
      return state;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      blocks.clear();
      pulleys.clear();
      springs.length = 0;
      bumpers.clear();
      freeBodies.length = 0;
      touching.clear();
      swinging.clear();
      world.free();
    },
  };
}
