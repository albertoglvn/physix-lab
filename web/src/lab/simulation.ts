import type { ColliderDesc, RigidBody } from "@dimforge/rapier3d-compat";
import {
  parseScene,
  radians,
  rampHeight,
  type LabObject,
  type Pulley,
  type Ramp,
} from "./scene.ts";

export const TIME_STEP = 1 / 120;
export const SOLVER_ITERATIONS = 8;
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

export function initialBlockState(
  block: Extract<LabObject, { kind: "block" }>,
): BlockState {
  const halfAngle = radians(block.rotation) / 2;
  return {
    position: { x: block.x, y: block.y, z: block.z },
    rotation: { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) },
    velocity: { x: block.vx, y: 0, z: 0 },
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
  let ticks = 0;
  let disposed = false;

  const friction = (desc: ColliderDesc, coefficient: number) =>
    desc
      .setFriction(coefficient)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Multiply);

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
      if (object.kind === "block") {
        const { position, rotation, velocity } = initialBlockState(object);
        const body = world.createRigidBody(
          rapier.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setRotation(rotation)
            .setLinvel(velocity.x, velocity.y, velocity.z)
            .setCcdEnabled(true),
        );
        const half = object.size / 2;
        world.createCollider(
          friction(rapier.ColliderDesc.cuboid(half, half, half), 1).setMass(
            object.mass,
          ),
          body,
        );
        blocks.set(object.id, body);
      } else if (object.kind === "ramp") {
        const desc = rapier.ColliderDesc.convexHull(
          new Float32Array(rampVertices(object)),
        );
        if (!desc) throw new Error("Could not construct the ramp collider.");
        world.createCollider(
          friction(desc, object.friction).setTranslation(object.x, 0, object.z),
        );
      } else {
        pulleys.set(object.id, object);
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
      for (let i = 0; i < count; i++) world.step();
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
      world.free();
    },
  };
}
