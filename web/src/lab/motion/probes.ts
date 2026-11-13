import {
  bodyHalf,
  isBody,
  radians,
  RAMP_CLEARANCE,
  rampPlacement,
  springSag,
  type Body,
  type LabScene,
  type Pendulum,
  type Ramp,
  type Spring,
} from "../scene";
import { springForce, type BlockState, type Simulation } from "../simulation";

/** Default probe rate. Samples land on multiples of 1/60 s at every supported step size. */
export const PROBE_RATE = 60;
/** A block is at rest below this speed, once it has moved faster than MOVING_SPEED. */
export const REST_SPEED = 0.01;
const MOVING_SPEED = 0.05;
/** A block's lowest point within this height of the floor counts as touching it. */
export const CONTACT_GAP = 0.005;

export type QuantitySource = "rapier" | "ideal-atwood" | "derived";

/** One recorded column, such as `block-1.speed`, in SI units. */
export type Quantity = {
  key: string;
  target: string;
  label: string;
  symbol: string;
  unit: string;
  source: QuantitySource;
};

export type EventType =
  "rest" | "leaves_ramp" | "floor_contact" | "pulley_stop";
export type RunEvent = { type: EventType; target: string; t: number };

export const EVENT_LABELS: Record<EventType, string> = {
  rest: "Comes to rest",
  leaves_ramp: "Leaves the ramp",
  floor_contact: "Touches the floor",
  pulley_stop: "Weight reaches its stop",
};

/** How a run ends: the first matching event, or the time limit. */
export type Protocol = { stop: EventType | "time"; maxTime: number };
export const MAX_TIME_LIMITS = [0.5, 60] as const;

type Trigger = { type: EventType; target: string; ramp?: Ramp };

/** The ramp a body starts on, when it was placed on one. */
export function startingRamp(
  block: Body,
  scene: LabScene,
): { ramp: Ramp; fraction: number } | undefined {
  for (const part of scene.objects) {
    if (part.kind !== "ramp") continue;
    const placement = rampPlacement(block, part);
    if (placement) return { ramp: part, fraction: placement.fraction };
  }
}

/** Height of a cube's lowest corner above its centre, from its orientation. */
export function lowestOffset(size: number, rotation: BlockState["rotation"]) {
  const { x, y, z, w } = rotation;
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  return (size / 2) * (Math.abs(r10) + Math.abs(r11) + Math.abs(r12));
}

/** Height of a body's lowest point above its centre, from its orientation. */
export const bodyLowest = (body: Body, rotation: BlockState["rotation"]) =>
  body.kind === "block" ? lowestOffset(body.size, rotation) : body.radius;

/** The upright orientation a body starts with. */
export function startRotation(body: Body): BlockState["rotation"] {
  const halfAngle = body.kind === "block" ? radians(body.rotation) / 2 : 0;
  return { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) };
}

/**
 * Fraction along the ramp at which a body leaves it: a block's front edge reaches the foot,
 * a ball's contact point does.
 */
export function leaveFraction(block: Body, ramp: Ramp) {
  if (block.kind === "ball") return 1;
  return 1 - ((block.size / 2) * Math.cos(radians(ramp.angle))) / ramp.length;
}

/** Moment of inertia of a body about its centre, in kg·m². */
export const bodyInertia = (body: Body) =>
  body.kind === "block"
    ? (body.mass * body.size * body.size) / 6
    : 0.4 * body.mass * body.radius * body.radius;

function triggers(scene: LabScene): Trigger[] {
  const list: Trigger[] = [];
  for (const part of scene.objects) {
    if (part.kind === "pulley") {
      list.push({ type: "pulley_stop", target: part.id });
      continue;
    }
    if (!isBody(part)) continue;
    const start = startingRamp(part, scene);
    if (start)
      list.push({ type: "leaves_ramp", target: part.id, ramp: start.ramp });
    const lowest = part.y - bodyLowest(part, startRotation(part));
    if (!start && lowest > CONTACT_GAP)
      list.push({ type: "floor_contact", target: part.id });
    list.push({ type: "rest", target: part.id });
  }
  return list;
}

/** Stop events this scene can raise, in the order the protocol picker lists them. */
export function availableStops(scene: LabScene): EventType[] {
  const types = new Set(triggers(scene).map((trigger) => trigger.type));
  return (Object.keys(EVENT_LABELS) as EventType[]).filter((type) =>
    types.has(type),
  );
}

/** The stop that suits the scene: the pulley stop, leaving a ramp, landing, then rest. */
export function defaultProtocol(scene: LabScene): Protocol {
  const stops = availableStops(scene);
  const moving = scene.objects.some((part) => isBody(part) && part.vx !== 0);
  const stop =
    (["pulley_stop", "leaves_ramp", "floor_contact"] as const).find((type) =>
      stops.includes(type),
    ) ?? (moving && stops.includes("rest") ? "rest" : "time");
  return { stop, maxTime: 10 };
}

/** Keeps a chosen protocol only when the scene can raise its stop event. */
export function protocolFor(
  scene: LabScene,
  chosen: Protocol | null,
): Protocol {
  if (!chosen) return defaultProtocol(scene);
  if (chosen.stop !== "time" && !availableStops(scene).includes(chosen.stop))
    return { ...defaultProtocol(scene), maxTime: chosen.maxTime };
  return chosen;
}

export function parseProtocol(input: unknown): Protocol {
  if (typeof input !== "object" || input === null)
    throw new Error("The protocol must be an object.");
  const { stop, maxTime } = input as Record<string, unknown>;
  if (
    stop !== "time" &&
    !(typeof stop === "string" && Object.hasOwn(EVENT_LABELS, stop))
  )
    throw new Error(
      `The protocol stop must be "time" or one of ${Object.keys(EVENT_LABELS).join(", ")}.`,
    );
  const [min, max] = MAX_TIME_LIMITS;
  if (
    typeof maxTime !== "number" ||
    !Number.isFinite(maxTime) ||
    maxTime < min ||
    maxTime > max
  )
    throw new Error(`The time limit must be between ${min} and ${max} s.`);
  return { stop: stop as Protocol["stop"], maxTime };
}

export type Series = { t: number[]; columns: Record<string, number[]> };

export type Recorder = {
  readonly quantities: Quantity[];
  readonly series: Series;
  readonly events: RunEvent[];
  /** Records the state after the latest step; returns the events it raised. */
  afterStep: () => RunEvent[];
  /** Adds a sample at the current time unless one is already there. */
  sample: () => void;
};

const BODY_QUANTITIES = [
  ["x", "X position", "x", "m"],
  ["y", "Height", "y", "m"],
  ["z", "Z position", "z", "m"],
  ["vx", "X velocity", "vx", "m/s"],
  ["vy", "Y velocity", "vy", "m/s"],
  ["vz", "Z velocity", "vz", "m/s"],
  ["speed", "Speed", "v", "m/s"],
  ["acceleration", "Acceleration", "a", "m/s²"],
  ["kinetic", "Kinetic energy", "K", "J"],
  ["potential", "Potential energy", "U", "J"],
] as const;
const PULLEY_QUANTITIES = [
  ["displacement", "Displacement", "s", "m"],
  ["speed", "Rope speed", "v", "m/s"],
  ["acceleration", "Acceleration", "a", "m/s²"],
  ["tension", "Tension", "T", "N"],
] as const;
const PENDULUM_QUANTITIES = [
  ["angle", "Angle", "θ", "rad"],
  ["omega", "Angular velocity", "ω", "rad/s"],
  ["x", "Bob X position", "x", "m"],
  ["y", "Bob height", "y", "m"],
  ["speed", "Bob speed", "v", "m/s"],
  ["tension", "Rod tension", "T", "N"],
  ["kinetic", "Kinetic energy", "K", "J"],
  ["potential", "Potential energy", "U", "J"],
] as const;
const SPRING_QUANTITIES = [
  ["y", "Height", "y", "m"],
  ["vy", "Y velocity", "vy", "m/s"],
  ["displacement", "Displacement from equilibrium", "u", "m"],
  ["extension", "Extension", "e", "m"],
  ["force", "Spring force", "F", "N"],
  ["kinetic", "Kinetic energy", "K", "J"],
  ["potential", "Gravitational energy", "U", "J"],
  ["elastic", "Elastic energy", "Uₛ", "J"],
] as const;
/** Columns read straight from the engine; the rest are derived from them. */
const ENGINE_COLUMNS = new Set([
  "x",
  "y",
  "z",
  "vx",
  "vy",
  "vz",
  "speed",
  "omega",
]);
const SYSTEM_QUANTITIES = [
  ["kinetic", "Kinetic energy", "K", "J"],
  ["potential", "Potential energy", "U", "J"],
  ["energy", "Mechanical energy", "E", "J"],
  ["px", "X momentum", "px", "kg·m/s"],
  ["py", "Y momentum", "py", "kg·m/s"],
  ["pz", "Z momentum", "pz", "kg·m/s"],
] as const;

export const SYSTEM = "system";

export function sceneQuantities(scene: LabScene): Quantity[] {
  const list: Quantity[] = [];
  for (const part of scene.objects) {
    const set = isBody(part)
      ? BODY_QUANTITIES
      : part.kind === "pendulum"
        ? PENDULUM_QUANTITIES
        : part.kind === "spring"
          ? SPRING_QUANTITIES
          : undefined;
    if (set)
      for (const [name, label, symbol, unit] of set)
        list.push({
          key: `${part.id}.${name}`,
          target: part.id,
          label,
          symbol,
          unit,
          source: ENGINE_COLUMNS.has(name) ? "rapier" : "derived",
        });
    else if (part.kind === "pulley")
      for (const [name, label, symbol, unit] of PULLEY_QUANTITIES)
        list.push({
          key: `${part.id}.${name}`,
          target: part.id,
          label,
          symbol,
          unit,
          source: "ideal-atwood",
        });
  }
  for (const [name, label, symbol, unit] of SYSTEM_QUANTITIES)
    list.push({
      key: `${SYSTEM}.${name}`,
      target: SYSTEM,
      label,
      symbol,
      unit,
      source: "derived",
    });
  return list;
}

/**
 * Samples every probe at `rate` from a running simulation and watches for events on every
 * step. Acceleration is a backward finite difference of velocity over one sample interval;
 * the first sample repeats the second.
 */
export function createRecorder(
  scene: LabScene,
  simulation: Simulation,
  rate = PROBE_RATE,
): Recorder {
  const dt = simulation.timeStep;
  const decimation = Math.max(1, Math.round(1 / (rate * dt)));
  const quantities = sceneQuantities(scene);
  const series: Series = {
    t: [],
    columns: Object.fromEntries(quantities.map(({ key }) => [key, []])),
  };
  const events: RunEvent[] = [];
  const pending = triggers(scene);
  const moved = new Set<string>();
  const blocks = scene.objects.filter(isBody);
  const pulleys = scene.objects.filter((part) => part.kind === "pulley");
  const pendulums = scene.objects.filter(
    (part): part is Pendulum => part.kind === "pendulum",
  );
  const springs = scene.objects.filter(
    (part): part is Spring => part.kind === "spring",
  );
  const g = scene.gravity;
  const previous = new Map<
    string,
    { t: number; v: [number, number, number] }
  >();
  let ticks = 0;

  const push = (key: string, value: number) => series.columns[key].push(value);

  function sample() {
    const t = ticks * dt;
    if (series.t.length && series.t[series.t.length - 1] === t) return;
    series.t.push(t);
    let kinetic = 0;
    let potential = 0;
    const momentum = [0, 0, 0];
    for (const block of blocks) {
      const state = simulation.block(block.id);
      if (!state) continue;
      const { position: p, velocity: v } = state;
      const w = state.angularVelocity ?? { x: 0, y: 0, z: 0 };
      const speed = Math.hypot(v.x, v.y, v.z);
      const inertia = bodyInertia(block);
      const k =
        0.5 * block.mass * speed * speed +
        0.5 * inertia * (w.x * w.x + w.y * w.y + w.z * w.z);
      const u = block.mass * scene.gravity * p.y;
      const before = previous.get(block.id);
      const acceleration = before
        ? Math.hypot(v.x - before.v[0], v.y - before.v[1], v.z - before.v[2]) /
          (t - before.t)
        : Number.NaN;
      previous.set(block.id, { t, v: [v.x, v.y, v.z] });
      const id = block.id;
      push(`${id}.x`, p.x);
      push(`${id}.y`, p.y);
      push(`${id}.z`, p.z);
      push(`${id}.vx`, v.x);
      push(`${id}.vy`, v.y);
      push(`${id}.vz`, v.z);
      push(`${id}.speed`, speed);
      push(`${id}.acceleration`, acceleration);
      push(`${id}.kinetic`, k);
      push(`${id}.potential`, u);
      const column = series.columns[`${id}.acceleration`];
      if (column.length === 2) column[0] = column[1];
      kinetic += k;
      potential += u;
      momentum[0] += block.mass * v.x;
      momentum[1] += block.mass * v.y;
      momentum[2] += block.mass * v.z;
    }
    for (const pendulum of pendulums) {
      const state = simulation.block(pendulum.id);
      if (!state) continue;
      const { position: p, velocity: v } = state;
      const id = pendulum.id;
      const theta = Math.atan2(p.x - pendulum.x, pendulum.pivotHeight - p.y);
      const omega = state.angularVelocity?.z ?? 0;
      const speed = Math.hypot(v.x, v.y, v.z);
      const spin = 0.4 * pendulum.mass * pendulum.bobRadius ** 2;
      const k = 0.5 * pendulum.mass * speed * speed + 0.5 * spin * omega ** 2;
      const u = pendulum.mass * g * p.y;
      push(`${id}.angle`, theta);
      push(`${id}.omega`, omega);
      push(`${id}.x`, p.x);
      push(`${id}.y`, p.y);
      push(`${id}.speed`, speed);
      push(
        `${id}.tension`,
        pendulum.mass * (g * Math.cos(theta) + omega * omega * pendulum.length),
      );
      push(`${id}.kinetic`, k);
      push(`${id}.potential`, u);
      kinetic += k;
      potential += u;
      momentum[0] += pendulum.mass * v.x;
      momentum[1] += pendulum.mass * v.y;
      momentum[2] += pendulum.mass * v.z;
    }
    for (const spring of springs) {
      const state = simulation.block(spring.id);
      if (!state) continue;
      const y = state.position.y;
      const vy = state.velocity.y;
      const id = spring.id;
      const top = y + spring.size / 2;
      const extension = spring.anchorHeight - top - spring.restLength;
      const equilibrium =
        spring.anchorHeight -
        spring.restLength -
        springSag(spring, g) -
        spring.size / 2;
      const k = 0.5 * spring.mass * vy * vy;
      const u = spring.mass * g * y;
      const elastic = 0.5 * spring.stiffness * extension * extension;
      push(`${id}.y`, y);
      push(`${id}.vy`, vy);
      push(`${id}.displacement`, y - equilibrium);
      push(`${id}.extension`, extension);
      push(`${id}.force`, springForce(spring, top, vy));
      push(`${id}.kinetic`, k);
      push(`${id}.potential`, u);
      push(`${id}.elastic`, elastic);
      kinetic += k;
      potential += u + elastic;
      momentum[1] += spring.mass * vy;
    }
    for (const pulley of pulleys) {
      const state = simulation.pulley(pulley.id);
      if (!state) continue;
      const id = pulley.id;
      push(`${id}.displacement`, state.displacement);
      push(`${id}.speed`, state.speed);
      push(`${id}.acceleration`, state.acceleration);
      push(`${id}.tension`, state.tension ?? Number.NaN);
      // Positive displacement lowers the right weight and raises the left one.
      kinetic += 0.5 * (pulley.leftMass + pulley.rightMass) * state.speed ** 2;
      potential +=
        scene.gravity *
        (pulley.leftMass - pulley.rightMass) *
        state.displacement;
      momentum[1] += (pulley.leftMass - pulley.rightMass) * state.speed;
    }
    push(`${SYSTEM}.kinetic`, kinetic);
    push(`${SYSTEM}.potential`, potential);
    push(`${SYSTEM}.energy`, kinetic + potential);
    push(`${SYSTEM}.px`, momentum[0]);
    push(`${SYSTEM}.py`, momentum[1]);
    push(`${SYSTEM}.pz`, momentum[2]);
  }

  function detect(): RunEvent[] {
    const t = ticks * dt;
    const raised: RunEvent[] = [];
    for (let index = pending.length - 1; index >= 0; index--) {
      const trigger = pending[index];
      let fired = false;
      if (trigger.type === "pulley_stop") {
        fired = simulation.pulley(trigger.target)?.stopped ?? false;
      } else {
        const block = blocks.find((part) => part.id === trigger.target);
        const state = block && simulation.block(block.id);
        if (!block || !state) continue;
        const speed = Math.hypot(
          state.velocity.x,
          state.velocity.y,
          state.velocity.z,
        );
        if (trigger.type === "rest") {
          if (speed > MOVING_SPEED) moved.add(block.id);
          fired = moved.has(block.id) && speed < REST_SPEED;
        } else if (trigger.type === "floor_contact") {
          fired =
            state.position.y - bodyLowest(block, state.rotation) <= CONTACT_GAP;
        } else if (trigger.ramp) {
          const ramp = trigger.ramp;
          const tilt = radians(ramp.angle);
          const normalOffset =
            (bodyHalf(block) + RAMP_CLEARANCE) * Math.sin(tilt);
          const fraction =
            (state.position.x - ramp.x - normalOffset) / ramp.length + 0.5;
          fired = fraction >= leaveFraction(block, ramp);
        }
      }
      if (fired) {
        const event = { type: trigger.type, target: trigger.target, t };
        raised.push(event);
        events.push(event);
        pending.splice(index, 1);
      }
    }
    return raised;
  }

  sample();
  for (const block of blocks) {
    const state = simulation.block(block.id);
    if (
      state &&
      Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) >
        MOVING_SPEED
    )
      moved.add(block.id);
  }

  return {
    quantities,
    series,
    events,
    afterStep() {
      ticks++;
      if (ticks % decimation === 0) sample();
      return detect();
    },
    sample,
  };
}
