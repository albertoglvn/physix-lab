import type { ColliderDesc, RigidBody } from "@dimforge/rapier3d-compat";
import {
  parseScene,
  radians,
  rampHeight,
  springEquilibrium,
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

/**
 * Advances an Atwood machine by one step of `h` seconds. While the rope is taut both
 * weights move with the Atwood acceleration, integrated exactly. A slack rope lets each
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
  const taut = y1 + y2 - ROPE_SUM <= ROPE_SLACK && v1 + v2 <= ROPE_SLACK;
  if (taut) {
    const a = ideal.acceleration;
    const u = (v1 - v2) / 2;
    const resting = Math.abs(u) <= ROPE_SLACK;
    if (resting && ((a > 0 && atLow(y2)) || (a < 0 && atHigh(y2)))) {
      // The right weight holds the system; the rope carries the left weight.
      v1 = v2 = wheel = 0;
      t1 = t2 = m1 * g;
    } else if (resting && ((a > 0 && atHigh(y1)) || (a < 0 && atLow(y1)))) {
      v1 = v2 = wheel = 0;
      t1 = t2 = m2 * g;
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
    y2 += v2 * h - (g * h * h) / 2;
    v1 -= g * h;
    v2 -= g * h;
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

export type BodyPart = Exclude<LabObject, Ramp | Pulley>;

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
      velocity: { x: part.vx, y: 0, z: 0 },
    };
  }
  if (part.kind === "ball")
    return {
      position: { x: part.x, y: part.y, z: part.z },
      rotation: upright,
      velocity: { x: part.vx, y: 0, z: 0 },
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

export type Simulation = {
  readonly rapierVersion: string;
  readonly timeStep: number;
  readonly solverIterations: number;
  readonly time: number;
  step: (count?: number) => void;
  /** The rigid body of a block, ball, pendulum bob or spring cube. */
  block: (id: string) => BlockState | undefined;
  pulley: (id: string) => PulleyState | undefined;
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
  let ticks = 0;
  let disposed = false;

  const friction = (desc: ColliderDesc, coefficient: number) =>
    desc
      .setFriction(coefficient)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Multiply);

  function shape(part: BodyPart) {
    if (part.kind === "ball") return rapier.ColliderDesc.ball(part.radius);
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
        .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
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

  /** Hinges the bob to a fixed pivot about z: a rigid, massless rod. */
  function hinge(pendulum: Pendulum, bob: RigidBody) {
    const pivot = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(
        pendulum.x,
        pendulum.pivotHeight,
        pendulum.z,
      ),
    );
    const theta = radians(pendulum.angle);
    world.createImpulseJoint(
      rapier.JointData.revolute(
        { x: 0, y: 0, z: 0 },
        {
          x: -pendulum.length * Math.sin(theta),
          y: pendulum.length * Math.cos(theta),
          z: 0,
        },
        { x: 0, y: 0, z: 1 },
      ),
      pivot,
      bob,
      true,
    );
  }

  try {
    world.timestep = timeStep;
    world.numSolverIterations = SOLVER_ITERATIONS;
    world.createCollider(
      friction(
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
          friction(desc, object.friction).setTranslation(object.x, 0, object.z),
        );
      } else if (object.kind === "pulley") {
        pulleys.set(object.id, atwoodMachine(object));
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
        world.createCollider(
          friction(shape(object), 1).setMass(object.mass),
          body,
        );
        if (object.kind === "pendulum") hinge(object, body);
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
        for (const rope of pulleys.values()) moveRope(rope);
        world.step();
      }
      ticks += count;
    },
    block(id) {
      const body = blocks.get(id);
      if (body)
        return {
          position: body.translation(),
          rotation: body.rotation(),
          velocity: body.linvel(),
          angularVelocity: body.angvel(),
        };
    },
    pulley(id) {
      return pulleys.get(id)?.state;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      blocks.clear();
      pulleys.clear();
      springs.length = 0;
      world.free();
    },
  };
}
