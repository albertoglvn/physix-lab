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
export const PULLEY_WEIGHT_HEIGHT = 2;
export const PULLEY_TRAVEL = 1.55;

export type Vec3 = { x: number; y: number; z: number };
type Rotation = Vec3 & { w: number };
export type BlockState = {
  position: Vec3;
  rotation: Rotation;
  velocity: Vec3;
  /** Angular velocity in rad/s about the world axes. */
  angularVelocity?: Vec3;
};
export type PulleyState = {
  displacement: number;
  speed: number;
  acceleration: number;
  tension: number | null;
  stopped: boolean;
};

/** Positive displacement lowers the right-hand mass. Stops end the ideal model. */
export function pulleyState(
  pulley: Pulley,
  gravity: number,
  time: number,
): PulleyState {
  const { leftMass, rightMass } = pulley;
  const acceleration =
    (gravity * (rightMass - leftMass)) / (rightMass + leftMass);
  const displacement = (acceleration * time * time) / 2;
  if (Math.abs(displacement) >= PULLEY_TRAVEL)
    return {
      displacement: Math.sign(displacement) * PULLEY_TRAVEL,
      speed: 0,
      acceleration: 0,
      tension: null,
      stopped: true,
    };
  return {
    displacement,
    speed: acceleration * time,
    acceleration,
    tension: leftMass * (gravity + acceleration),
    stopped: false,
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
  const pulleys = new Map<string, Pulley>();
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
        pulleys.set(object.id, object);
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
      const pulley = pulleys.get(id);
      if (pulley) return pulleyState(pulley, scene.gravity, ticks * timeStep);
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
