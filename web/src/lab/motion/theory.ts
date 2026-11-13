import { ellipticK, meanPeriod } from "../data/period";
import {
  bodyHalf,
  contactFriction,
  dragCoefficients,
  hasDrag,
  isBody,
  radians,
  rollingFactor,
  type Ball,
  type Block,
  type Body,
  type Cylinder,
  type LabObject,
  type LabScene,
  type Pendulum,
  type Pulley,
  type Ramp,
  type Spring,
} from "../scene";
import { atwood, PULLEY_TRAVEL } from "../simulation";
import {
  bodyLowest,
  canLand,
  headOnPairs,
  leaveFraction,
  startingRamp,
  startRotation,
  type EventType,
} from "./probes";
import { eventOf, valueAt, type MotionRun } from "./run";

/** Closed-form curve drawn dashed behind a probe series. */
export type TheoryCurve = {
  key: string;
  at: (t: number) => number;
  until: number;
};

/**
 * A closed-form value for one quantity, with the assumptions it needs and how to read the
 * matching value from a run (LAB_PLAN.md §4.1).
 */
export type Reference = {
  id: string;
  target: string;
  label: string;
  symbol: string;
  unit: string;
  formula: string;
  value: number;
  assumptions: string[];
  /** Why the scene leaves the reference's assumptions, when it does. */
  broken?: string;
  /** Relative tolerance; below `floor` in magnitude the difference is compared absolutely. */
  tolerance: number;
  floor: number;
  /** The event a run must reach before the reference can be measured. */
  event?: EventType;
  measure: (run: MotionRun) => number | undefined;
};

export type Comparison = {
  reference: Reference;
  measured?: number;
  /** Relative difference, or absolute when the reference is near zero. */
  delta?: number;
  relative: boolean;
  within?: boolean;
};

export const CONTACT_MODEL =
  "One Coulomb coefficient per contact pair (static equals kinetic): the smaller of the two parts' coefficients, so a body without its own coefficient leaves the surface's in charge. Restitution is the larger of the two; floors and ramps have none.";

const eventTime = (run: MotionRun, type: EventType, target: string) =>
  eventOf(run, type, target)?.t;

/** Least-squares slope of a column against time over [from, to]. */
export function slope(
  run: MotionRun,
  key: string,
  from: number,
  to: number,
): number | undefined {
  const column = run.series.columns[key];
  if (!column) return;
  let n = 0;
  let st = 0;
  let sv = 0;
  let stt = 0;
  let stv = 0;
  run.series.t.forEach((t, index) => {
    const v = column[index];
    if (t < from || t > to || !Number.isFinite(v)) return;
    n++;
    st += t;
    sv += v;
    stt += t * t;
    stv += t * v;
  });
  const denominator = n * stt - st * st;
  if (n < 5 || denominator <= 0) return;
  return (n * stv - st * sv) / denominator;
}

/** Half-extents of a part's footprint along x and z, or undefined for the pulley. */
function footprint(part: LabObject): [number, number] | undefined {
  if (isBody(part)) return [bodyHalf(part), bodyHalf(part)];
  if (part.kind === "ramp") return [part.length / 2, part.width / 2];
  if (part.kind === "pendulum")
    return [part.length + part.bobRadius, part.bobRadius];
  if (part.kind === "spring") return [part.size / 2, part.size / 2];
}

const sharesPath = (
  block: Body,
  others: LabObject[],
  from: number,
  to: number,
): LabObject | undefined =>
  others.find((part) => {
    const extent = part.id === block.id ? undefined : footprint(part);
    if (!extent) return false;
    const half = bodyHalf(block);
    const [low, high] = from < to ? [from, to] : [to, from];
    return (
      part.x + extent[0] > low - half &&
      part.x - extent[0] < high + half &&
      Math.abs(part.z - block.z) < extent[1] + half
    );
  });

/** Another body that starts on the same ramp, which the closed forms leave out. */
const rampNeighbour = (body: Body, ramp: Ramp, scene: LabScene) =>
  scene.objects.find(
    (part) =>
      isBody(part) &&
      part.id !== body.id &&
      startingRamp(part, scene)?.ramp.id === ramp.id,
  );

function inclineReferences(
  block: Block,
  ramp: Ramp,
  fraction: number,
  scene: LabScene,
): Reference[] {
  const g = scene.gravity;
  const tilt = radians(ramp.angle);
  const mu = contactFriction(block, ramp.friction);
  const slides = Math.tan(tilt) > mu;
  const a = slides ? g * (Math.sin(tilt) - mu * Math.cos(tilt)) : 0;
  const distance =
    ((leaveFraction(block, ramp) - fraction) * ramp.length) / Math.cos(tilt);
  const neighbour = rampNeighbour(block, ramp, scene);
  const broken = neighbour ? `${neighbour.id} shares ${ramp.id}.` : undefined;
  const assumptions = [
    `Starts at rest on ${ramp.id}, ${ramp.angle.toFixed(0)}° with μ = ${mu}.`,
    "Slides without tipping; no air drag.",
    CONTACT_MODEL,
    "Starts 15 mm above the surface, so the first ~55 ms are free fall.",
  ];
  const end = (run: MotionRun) =>
    eventTime(run, "leaves_ramp", block.id) ?? run.stop.t;
  const references: Reference[] = [
    {
      id: `${block.id}.incline.a`,
      target: block.id,
      label: "Acceleration",
      symbol: "a",
      unit: "m/s²",
      formula: slides ? "a = g (sin θ − μ cos θ)" : "a = 0, since tan θ ≤ μ",
      value: a,
      assumptions,
      broken,
      tolerance: 0.02,
      floor: 0.05,
      measure: (run) => {
        const to = end(run) - 0.02;
        return to > 0.3 ? slope(run, `${block.id}.speed`, 0.15, to) : undefined;
      },
    },
  ];
  if (slides)
    references.push({
      id: `${block.id}.incline.t`,
      target: block.id,
      label: "Time on ramp",
      symbol: "t",
      unit: "s",
      formula: "t = √(2d / a)",
      value: Math.sqrt((2 * distance) / a),
      assumptions,
      broken,
      tolerance: 0.03,
      floor: 0,
      event: "leaves_ramp",
      measure: (run) => eventTime(run, "leaves_ramp", block.id),
    });
  return references;
}

/**
 * A round body (I = k m r²) released on a ramp rolls without slipping while
 * μ ≥ k/(1 + k) tan θ, at a = g sin θ/(1 + k); below that it slips, and kinetic friction
 * gives g (sin θ − μ cos θ). A solid ball has k = 2/5, a solid cylinder k = 1/2.
 */
function rollingReferences(
  ball: Ball | Cylinder,
  ramp: Ramp,
  fraction: number,
  scene: LabScene,
): Reference[] {
  const g = scene.gravity;
  const tilt = radians(ramp.angle);
  const mu = contactFriction(ball, ramp.friction);
  const k = rollingFactor(ball)!;
  const sphere = ball.kind === "ball";
  const rolls = mu >= (k / (1 + k)) * Math.tan(tilt);
  const a = rolls
    ? (g * Math.sin(tilt)) / (1 + k)
    : g * (Math.sin(tilt) - mu * Math.cos(tilt));
  const distance =
    ((leaveFraction(ball, ramp) - fraction) * ramp.length) / Math.cos(tilt);
  const neighbour = rampNeighbour(ball, ramp, scene);
  const broken = neighbour ? `${neighbour.id} shares ${ramp.id}.` : undefined;
  const threshold = sphere ? "(2/7) tan θ" : "(1/3) tan θ";
  const assumptions = [
    `Starts at rest on ${ramp.id}, ${ramp.angle.toFixed(0)}° with μ = ${mu}.`,
    rolls
      ? `Rolls without slipping, since μ ≥ ${threshold}; ${sphere ? "a solid sphere, I = (2/5) m r²" : "a solid cylinder about its axis, I = (1/2) m r²"}.`
      : `Slips throughout, since μ < ${threshold}; kinetic friction acts at the contact.`,
    "No rolling resistance or air drag.",
    CONTACT_MODEL,
    "Starts 15 mm above the surface, so the first ~55 ms are free fall.",
  ];
  const end = (run: MotionRun) =>
    eventTime(run, "leaves_ramp", ball.id) ?? run.stop.t;
  return [
    {
      id: `${ball.id}.rolling.a`,
      target: ball.id,
      label: "Acceleration",
      symbol: "a",
      unit: "m/s²",
      formula: rolls
        ? `a = (${sphere ? "5/7" : "2/3"}) g sin θ`
        : "a = g (sin θ − μ cos θ)",
      value: a,
      assumptions,
      broken,
      tolerance: 0.02,
      floor: 0.05,
      measure: (run) => {
        const to = end(run) - 0.02;
        return to > 0.3 ? slope(run, `${ball.id}.speed`, 0.15, to) : undefined;
      },
    },
    {
      id: `${ball.id}.rolling.t`,
      target: ball.id,
      label: "Time on ramp",
      symbol: "t",
      unit: "s",
      formula: "t = √(2d / a)",
      value: Math.sqrt((2 * distance) / a),
      assumptions,
      broken,
      tolerance: 0.03,
      floor: 0,
      event: "leaves_ramp",
      measure: (run) => eventTime(run, "leaves_ramp", ball.id),
    },
  ];
}

/** Largest release angle, in degrees, the small-angle period is taken to describe. */
export const SMALL_ANGLE = 10;

/** Moment of inertia of a pendulum about its pivot: the bob as a solid sphere. */
export const pendulumInertia = (pendulum: Pendulum) =>
  pendulum.mass * pendulum.length ** 2 +
  0.4 * pendulum.mass * pendulum.bobRadius ** 2;

/** Small-angle period of a pendulum, 2π √(I / (m g L)). */
export function smallAnglePeriod(pendulum: Pendulum, gravity: number) {
  return (
    2 *
    Math.PI *
    Math.sqrt(
      pendulumInertia(pendulum) / (pendulum.mass * gravity * pendulum.length),
    )
  );
}

/** Period at any release angle: the small-angle period times (2/π) K(sin(θ₀/2)). */
export function exactPeriod(pendulum: Pendulum, gravity: number) {
  const k = Math.sin(radians(Math.abs(pendulum.angle)) / 2);
  return (smallAnglePeriod(pendulum, gravity) * 2 * ellipticK(k)) / Math.PI;
}

/**
 * Mean period of a recorded column about zero, up to `until`. A decaying oscillation is cut
 * where it fades into the engine's single-precision round-off, which would add false crossings.
 */
const recordedPeriod = (
  run: MotionRun,
  key: string,
  until = Number.POSITIVE_INFINITY,
) => {
  const column = run.series.columns[key];
  if (!column) return undefined;
  const end = run.series.t.findIndex((t) => t > until);
  const count = end < 0 ? column.length : end;
  return meanPeriod(run.series.t.slice(0, count), column.slice(0, count), 0);
};

/** Envelope decay, 10⁻³ of the release offset, over which a damped period is measured. */
const FADE = Math.log(1e3);

function pendulumReferences(pendulum: Pendulum, scene: LabScene): Reference[] {
  if (pendulum.angle === 0 || scene.gravity === 0) return [];
  const g = scene.gravity;
  const id = pendulum.id;
  const assumptions = [
    `Released from rest at ${pendulum.angle}° on a rigid, massless rod of ${pendulum.length} m.`,
    `The bob is a solid sphere, so I = m L² + (2/5) m r² about the pivot.`,
    "Frictionless hinge; no air drag.",
  ];
  const measure = (run: MotionRun) => recordedPeriod(run, `${id}.angle`);
  const large = Math.abs(pendulum.angle) > SMALL_ANGLE;
  return [
    {
      id: `${id}.pendulum.T0`,
      target: id,
      label: "Small-angle period",
      symbol: "T₀",
      unit: "s",
      formula: "T₀ = 2π √(I / (m g L))",
      value: smallAnglePeriod(pendulum, g),
      assumptions: [
        ...assumptions,
        `Small swings, sin θ ≈ θ (within ${SMALL_ANGLE}°).`,
      ],
      broken: large
        ? `Released at ${pendulum.angle}°, beyond the small-angle range.`
        : undefined,
      tolerance: 0.005,
      floor: 0,
      measure,
    },
    {
      id: `${id}.pendulum.T`,
      target: id,
      label: "Period",
      symbol: "T",
      unit: "s",
      formula: "T = (2/π) T₀ K(sin(θ₀/2))",
      value: exactPeriod(pendulum, g),
      assumptions: [
        ...assumptions,
        "K is the complete elliptic integral of the first kind.",
      ],
      tolerance: 0.005,
      floor: 0,
      measure,
    },
  ];
}

/** Natural angular frequency and damping ratio of a spring oscillator. */
export function springModes(spring: Spring) {
  const omega0 = Math.sqrt(spring.stiffness / spring.mass);
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
  return { omega0, zeta };
}

function springReferences(spring: Spring): Reference[] {
  if (spring.offset === 0) return [];
  const { omega0, zeta } = springModes(spring);
  const id = spring.id;
  const assumptions = [
    `Released from rest ${Math.abs(spring.offset)} m ${spring.offset > 0 ? "above" : "below"} equilibrium.`,
    `Linear spring, k = ${spring.stiffness} N/m, and viscous damper, c = ${spring.damping} N·s/m; massless.`,
    "Moves along y only; no other contact.",
  ];
  return [
    {
      id: `${id}.spring.T`,
      target: id,
      label: spring.damping > 0 ? "Damped period" : "Period",
      symbol: "T",
      unit: "s",
      formula:
        spring.damping > 0 ? "T = 2π / (ω₀ √(1 − ζ²))" : "T = 2π √(m / k)",
      value:
        zeta < 1
          ? (2 * Math.PI) / (omega0 * Math.sqrt(1 - zeta * zeta))
          : Number.POSITIVE_INFINITY,
      assumptions: [
        ...assumptions,
        `ω₀ = √(k/m) = ${omega0.toPrecision(4)} rad/s, ζ = c / (2√(k m)) = ${zeta.toPrecision(3)}.`,
      ],
      broken:
        zeta >= 1
          ? `ζ = ${zeta.toPrecision(3)} ≥ 1, so the cube returns without oscillating.`
          : undefined,
      tolerance: 0.005,
      floor: 0,
      measure: (run) =>
        recordedPeriod(
          run,
          `${id}.displacement`,
          zeta > 0 ? FADE / (zeta * omega0) : undefined,
        ),
    },
  ];
}

function frictionReferences(block: Block, scene: LabScene): Reference[] {
  const mu = contactFriction(block, scene.floorFriction);
  const v0 = Math.abs(block.vx);
  if (v0 === 0) return [];
  const g = scene.gravity;
  const distance = mu > 0 ? (v0 * v0) / (2 * mu * g) : Number.POSITIVE_INFINITY;
  const direction = Math.sign(block.vx);
  const obstacle = sharesPath(
    block,
    scene.objects,
    block.x,
    block.x + direction * Math.min(distance, 40),
  );
  const broken =
    mu === 0
      ? "With μ = 0 the block never stops."
      : obstacle
        ? `${obstacle.id} is in the path.`
        : undefined;
  const assumptions = [
    `Slides on the floor from ${v0} m/s with μ = ${mu}.`,
    "Slides without tipping; no air drag.",
    CONTACT_MODEL,
  ];
  const restTime = (run: MotionRun) => eventTime(run, "rest", block.id);
  return [
    {
      id: `${block.id}.friction.d`,
      target: block.id,
      label: "Stopping distance",
      symbol: "d",
      unit: "m",
      formula: "d = v₀² / (2 μ g)",
      value: distance,
      assumptions,
      broken,
      tolerance: 0.02,
      floor: 0,
      event: "rest",
      measure: (run) => {
        const t = restTime(run);
        return t === undefined
          ? undefined
          : Math.abs(valueAt(run, `${block.id}.x`, t) - block.x);
      },
    },
    {
      id: `${block.id}.friction.t`,
      target: block.id,
      label: "Stopping time",
      symbol: "t",
      unit: "s",
      formula: "t = v₀ / (μ g)",
      value: mu > 0 ? v0 / (mu * g) : Number.POSITIVE_INFINITY,
      assumptions,
      broken,
      tolerance: 0.02,
      floor: 0,
      event: "rest",
      measure: restTime,
    },
  ];
}

/** Flight time of a body launched with vertical speed `vy` from `height` above the floor. */
export const flightTime = (vy: number, height: number, g: number) =>
  (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, height))) / g;

function projectileReferences(
  block: Body,
  height: number,
  scene: LabScene,
): Reference[] {
  const g = scene.gravity;
  const { vx, vy } = block;
  const fall = flightTime(vy, height, g);
  const range = Math.abs(vx) * fall;
  const obstacle = sharesPath(
    block,
    scene.objects.filter((part) => part.kind === "ramp"),
    block.x,
    block.x + Math.sign(vx || 1) * range,
  );
  const broken = obstacle ? `${obstacle.id} lies under the path.` : undefined;
  const lowest =
    block.kind === "block"
      ? "corner"
      : block.kind === "ball"
        ? "point"
        : "edge";
  const launch =
    vy === 0
      ? `Launched horizontally at ${vx} m/s`
      : `Launched at vₓ = ${vx} m/s, v_y = ${vy} m/s`;
  const assumptions = [
    `${launch} from ${Math.max(0, height).toFixed(2)} m above the floor.`,
    "No air drag; uniform gravity; no spin.",
    `Contact is detected to one step, as the lowest ${lowest} comes within 5 mm of the floor.`,
  ];
  const landing = (run: MotionRun) => eventTime(run, "floor_contact", block.id);
  const timeFormula =
    vy === 0 ? "t = √(2h / g)" : "t = (v_y + √(v_y² + 2 g h)) / g";
  const list: Reference[] = [
    {
      id: `${block.id}.projectile.t`,
      target: block.id,
      label: "Flight time",
      symbol: "t",
      unit: "s",
      formula: timeFormula,
      value: fall,
      assumptions,
      broken,
      tolerance: 0.01,
      floor: 0,
      event: "floor_contact",
      measure: landing,
    },
    {
      id: `${block.id}.projectile.r`,
      target: block.id,
      label: "Range",
      symbol: "R",
      unit: "m",
      formula: vy === 0 ? "R = |vₓ| √(2h / g)" : "R = |vₓ| t",
      value: range,
      assumptions,
      broken,
      tolerance: 0.01,
      floor: 0.05,
      event: "floor_contact",
      measure: (run) => {
        const t = landing(run);
        return t === undefined
          ? undefined
          : Math.abs(valueAt(run, `${block.id}.x`, t) - block.x);
      },
    },
  ];
  if (vy > 0)
    list.push({
      id: `${block.id}.projectile.h`,
      target: block.id,
      label: "Peak height",
      symbol: "y_max",
      unit: "m",
      formula: "y_max = y₀ + v_y² / (2g)",
      value: block.y + (vy * vy) / (2 * g),
      assumptions: [
        ...assumptions,
        "Read as the highest recorded centre height, sampled at the probe rate.",
      ],
      broken,
      tolerance: 0.005,
      floor: 0,
      event: "floor_contact",
      measure: (run) => {
        const end = landing(run);
        const column = run.series.columns[`${block.id}.y`];
        if (end === undefined || !column) return;
        let peak = Number.NEGATIVE_INFINITY;
        run.series.t.forEach((t, index) => {
          if (t <= end) peak = Math.max(peak, column[index]);
        });
        return peak;
      },
    });
  return list;
}

/**
 * The coefficient of restitution read across the first bounce: the vertical speeds at the
 * start and end of the bounce step, each carried from the nearest probe sample by free fall.
 */
export function bounceRatio(
  run: MotionRun,
  id: string,
  gravity: number,
): number | undefined {
  const t = eventTime(run, "bounce", id);
  const column = run.series.columns[`${id}.vy`];
  if (t === undefined || !column) return;
  const h = run.inputs.timeStep;
  const times = run.series.t;
  const slack = 1e-9;
  let before = -1;
  let after = -1;
  times.forEach((time, index) => {
    if (time <= t - h + slack) before = index;
    if (after < 0 && time >= t - slack) after = index;
  });
  if (before < 0 || after < 0) return;
  const down = column[before] - gravity * (t - h - times[before]);
  const up = column[after] + gravity * (times[after] - t);
  return down < 0 ? up / -down : undefined;
}

function bounceReferences(body: Body, scene: LabScene): Reference[] {
  const e = body.restitution;
  return [
    {
      id: `${body.id}.bounce.e`,
      target: body.id,
      label: "Coefficient of restitution",
      symbol: "e",
      unit: "",
      formula: "e = v_out / v_in",
      value: e,
      assumptions: [
        `${body.id} has e = ${e}; the floor has none, so the larger, ${e}, applies.`,
        "Speeds are taken just before and after the bounce step; the nearest samples are carried to it by free fall.",
        "The body sinks up to one step's travel into the floor before it rebounds, so the rebound height falls short of e² h₀ by about that depth; the speed ratio does not.",
      ],
      tolerance: 0.002,
      floor: 0.002,
      event: "bounce",
      measure: (run) => bounceRatio(run, body.id, scene.gravity),
    },
  ];
}

/** Velocities after a head-on impact of two balls with restitution e along x. */
export function impactVelocities(a: Ball, b: Ball) {
  const e = Math.max(a.restitution, b.restitution);
  const m = a.mass + b.mass;
  const p = a.mass * a.vx + b.mass * b.vx;
  const approach = a.vx - b.vx;
  return {
    e,
    v1: (p - b.mass * e * approach) / m,
    v2: (p + a.mass * e * approach) / m,
  };
}

/**
 * Fall time and impact speed of a body dropped from rest through air with quadratic drag
 * only: v(t) = v_t tanh(g t / v_t), with terminal speed v_t = √(m g / c), c = ½ ρ C_d A.
 */
export function quadraticDrop(
  height: number,
  mass: number,
  c: number,
  g: number,
) {
  const terminal = Math.sqrt((mass * g) / c);
  const ratio = (g * height) / terminal ** 2;
  return {
    terminal,
    time: (terminal / g) * Math.acosh(Math.exp(ratio)),
    speed: terminal * Math.sqrt(-Math.expm1(-2 * ratio)),
  };
}

/**
 * Flight of a body launched from `height` with linear drag k = b/m:
 * y(t) = h + (v_y + g/k)(1 − e^(−kt))/k − g t/k, x(t) = vₓ (1 − e^(−kt))/k.
 */
export function linearDragFlight(
  vx: number,
  vy: number,
  height: number,
  k: number,
  g: number,
) {
  const rise = (t: number) =>
    height + ((vy + g / k) * -Math.expm1(-k * t)) / k - (g * t) / k;
  // y falls monotonically after the apex, so the landing lies between it and the
  // first doubling that reaches the floor.
  let low = vy > 0 ? Math.log1p((k * vy) / g) / k : 0;
  let high = Math.max(low, 1e-3);
  while (rise(high) > 0) high *= 2;
  for (let i = 0; i < 200 && high - low > 1e-12; i++) {
    const mid = (low + high) / 2;
    if (rise(mid) > 0) low = mid;
    else high = mid;
  }
  const time = (low + high) / 2;
  return { time, range: (Math.abs(vx) * -Math.expm1(-k * time)) / k };
}

/**
 * The impact speed of a quadratic-drag drop, from the last sample at least one step before
 * landing, carried to the floor along v² = v_t² − (v_t² − v_s²) e^(−2 g Δ / v_t²).
 */
function dropImpactSpeed(
  run: MotionRun,
  body: Body,
  terminal: number,
  g: number,
): number | undefined {
  const t = eventTime(run, "floor_contact", body.id);
  const vy = run.series.columns[`${body.id}.vy`];
  const y = run.series.columns[`${body.id}.y`];
  if (t === undefined || !vy || !y) return;
  const limit = t - run.inputs.timeStep + 1e-9;
  let index = -1;
  run.series.t.forEach((time, at) => {
    if (time <= limit) index = at;
  });
  if (index < 0) return;
  const gap = Math.max(0, y[index] - bodyHalf(body));
  const v2 = terminal ** 2;
  return Math.sqrt(v2 - (v2 - vy[index] ** 2) * Math.exp((-2 * g * gap) / v2));
}

/**
 * References for a body falling through air, when a closed form exists: a drop from rest
 * with quadratic drag only, or any launch with linear drag only.
 */
function dragReferences(
  body: Body,
  height: number,
  scene: LabScene,
): Reference[] {
  const g = scene.gravity;
  const { linear, quadratic } = dragCoefficients(body, scene);
  const landing = (run: MotionRun) => eventTime(run, "floor_contact", body.id);
  const common = [
    "Uniform gravity; no spin; drag acts at the centre and opposes the velocity.",
    "The engine holds the drag over each step so the velocity follows the exact solution, with |v| at the step's midpoint.",
    "Contact is detected to one step, as the lowest point comes within 5 mm of the floor.",
  ];
  if (quadratic > 0 && linear === 0 && body.vx === 0 && body.vy === 0) {
    const { terminal, time, speed } = quadraticDrop(
      height,
      body.mass,
      quadratic,
      g,
    );
    const assumptions = [
      `Dropped from rest ${height.toFixed(2)} m above the floor through air of ρ = ${scene.airDensity} kg/m³.`,
      `Quadratic drag ½ ρ C_d A v² with c = ${quadratic.toPrecision(4)} kg/m, so v_t = √(m g / c) = ${terminal.toFixed(3)} m/s.`,
      ...common,
    ];
    return [
      {
        id: `${body.id}.drag.t`,
        target: body.id,
        label: "Fall time with drag",
        symbol: "t",
        unit: "s",
        formula: "t = (v_t / g) arcosh(e^(g h / v_t²))",
        value: time,
        assumptions,
        tolerance: 0.01,
        floor: 0,
        event: "floor_contact",
        measure: landing,
      },
      {
        id: `${body.id}.drag.v`,
        target: body.id,
        label: "Impact speed with drag",
        symbol: "v",
        unit: "m/s",
        formula: "v = v_t √(1 − e^(−2 g h / v_t²))",
        value: speed,
        assumptions: [
          ...assumptions,
          "Read from the last sample a step before landing, carried to the floor by the same law.",
        ],
        tolerance: 0.002,
        floor: 0,
        event: "floor_contact",
        measure: (run) => dropImpactSpeed(run, body, terminal, g),
      },
    ];
  }
  if (quadratic > 0 || linear === 0) return [];
  const k = linear / body.mass;
  const { time, range } = linearDragFlight(body.vx, body.vy, height, k, g);
  const assumptions = [
    `Launched at vₓ = ${body.vx} m/s, v_y = ${body.vy} m/s from ${height.toFixed(2)} m above the floor.`,
    `Linear drag b v with b = ${linear} N·s/m, so k = b / m = ${k.toPrecision(4)} 1/s.`,
    ...common,
  ];
  return [
    {
      id: `${body.id}.drag.t`,
      target: body.id,
      label: "Flight time with drag",
      symbol: "t",
      unit: "s",
      formula: "h + (v_y + g/k)(1 − e^(−kt))/k − g t/k = 0",
      value: time,
      assumptions,
      tolerance: 0.01,
      floor: 0,
      event: "floor_contact",
      measure: landing,
    },
    {
      id: `${body.id}.drag.r`,
      target: body.id,
      label: "Range with drag",
      symbol: "R",
      unit: "m",
      formula: "R = |vₓ| (1 − e^(−kt)) / k",
      value: range,
      assumptions,
      tolerance: 0.01,
      floor: 0.05,
      event: "floor_contact",
      measure: (run) => {
        const t = landing(run);
        return t === undefined
          ? undefined
          : Math.abs(valueAt(run, `${body.id}.x`, t) - body.x);
      },
    },
  ];
}

/** Acceleration, final speed and distance of a body pushed from rest along the floor. */
export function pushMotion(body: Body, scene: LabScene) {
  const force = body.force!;
  const g = scene.gravity;
  const mu = contactFriction(body, scene.floorFriction);
  const normal = body.mass * g - force.y;
  const grip = mu * Math.max(0, normal);
  const excess = Math.max(0, Math.abs(force.x) - grip);
  const a = (Math.sign(force.x) * excess) / body.mass;
  const duration = force.end - force.start;
  const v = a * duration;
  const distance =
    mu > 0
      ? Math.abs((a * duration ** 2) / 2) + v ** 2 / (2 * mu * g)
      : Infinity;
  return { mu, normal, a, v, duration, distance };
}

function pushReferences(body: Body, scene: LabScene): Reference[] {
  const force = body.force!;
  const { mu, normal, a, v, duration, distance } = pushMotion(body, scene);
  const round = body.kind !== "block";
  const travel = Math.min(Number.isFinite(distance) ? distance : 40, 40);
  const obstacle = sharesPath(
    body,
    scene.objects,
    body.x,
    body.x + Math.sign(force.x || 1) * travel,
  );
  const broken = hasDrag(scene)
    ? "Air drag acts; the push formulas leave it out."
    : normal <= 0
      ? "The vertical force lifts the body off the floor."
      : round && mu > 0
        ? `${body.id} would roll; the push formulas cover sliding, so set μ = 0 or use a block.`
        : obstacle
          ? `${obstacle.id} is in the path.`
          : undefined;
  const assumptions = [
    `Starts at rest on the floor; ${force.x} N along x and ${force.y} N along y from ${force.start} s to ${force.end} s.`,
    `Coulomb friction μ = ${mu} on a normal force of m g − F_y = ${normal.toFixed(3)} N while pushed, m g after.`,
    "Slides without tipping or rolling; no air drag.",
    CONTACT_MODEL,
  ];
  const vx = `${body.id}.vx`;
  const list: Reference[] = [];
  if (duration >= 0.25)
    list.push({
      id: `${body.id}.push.a`,
      target: body.id,
      label: "Acceleration while pushed",
      symbol: "a",
      unit: "m/s²",
      formula: "a = (Fₓ − μ (m g − F_y)) / m, or 0 when μ (m g − F_y) ≥ |Fₓ|",
      value: a,
      assumptions: [
        ...assumptions,
        "Read as the least-squares slope of vₓ over the middle 80 % of the push.",
      ],
      broken,
      tolerance: 0.01,
      floor: 0.01,
      measure: (run) => {
        const margin = 0.1 * duration;
        return run.stop.t >= force.end
          ? slope(run, vx, force.start + margin, force.end - margin)
          : undefined;
      },
    });
  list.push({
    id: `${body.id}.push.v`,
    target: body.id,
    label: "Speed when the force ends",
    symbol: "v",
    unit: "m/s",
    formula: "v = a (t_end − t_start)",
    value: Math.abs(v),
    assumptions,
    broken,
    tolerance: 0.01,
    floor: 0.01,
    measure: (run) =>
      run.stop.t >= force.end
        ? Math.abs(valueAt(run, vx, force.end))
        : undefined,
  });
  if (mu > 0 && a !== 0)
    list.push({
      id: `${body.id}.push.d`,
      target: body.id,
      label: "Distance to rest",
      symbol: "d",
      unit: "m",
      formula: "d = a T² / 2 + v² / (2 μ g)",
      value: distance,
      assumptions,
      broken,
      tolerance: 0.02,
      floor: 0,
      event: "rest",
      measure: (run) => {
        const t = eventTime(run, "rest", body.id);
        return t === undefined
          ? undefined
          : Math.abs(valueAt(run, `${body.id}.x`, t) - body.x);
      },
    });
  return list;
}

/** Why a body's drag-free, unforced closed forms do not apply, if they do not. */
function disturbance(body: Body, scene: LabScene): string | undefined {
  if (body.force)
    return `A force acts on ${body.id}; this formula leaves it out.`;
  if (hasDrag(scene))
    return `Air drag acts on ${body.id}; this formula assumes none.`;
}

const flag = (list: Reference[], reason: string | undefined) =>
  reason
    ? list.map((reference) => ({
        ...reference,
        broken: reference.broken ?? reason,
      }))
    : list;

function collisionReferences(a: Ball, b: Ball): Reference[] {
  const { e, v1, v2 } = impactVelocities(a, b);
  const assumptions = [
    `Equal ${a.radius} m balls meet centre to centre on a frictionless floor, so they slide without spinning and the contact normal is along x.`,
    `e is the larger of the two restitutions, ${e}.`,
    "Read at the end of the run, after the impact; the speeds stay constant once the balls part.",
  ];
  const after = (key: string) => (run: MotionRun) => {
    const hit = eventTime(run, "collision", a.id);
    return hit !== undefined && run.stop.t >= hit + 0.05
      ? valueAt(run, key, run.stop.t)
      : undefined;
  };
  const momentum = "m₁u₁ + m₂u₂";
  return [
    {
      id: `${a.id}.collision.v1`,
      target: a.id,
      label: "Velocity after impact",
      symbol: "v₁′",
      unit: "m/s",
      formula: `v₁′ = (${momentum} − m₂ e (u₁ − u₂)) / (m₁ + m₂)`,
      value: v1,
      assumptions,
      tolerance: 0.002,
      floor: 0.01,
      event: "collision",
      measure: after(`${a.id}.vx`),
    },
    {
      id: `${a.id}.collision.v2`,
      target: b.id,
      label: "Velocity after impact",
      symbol: "v₂′",
      unit: "m/s",
      formula: `v₂′ = (${momentum} + m₁ e (u₁ − u₂)) / (m₁ + m₂)`,
      value: v2,
      assumptions,
      tolerance: 0.002,
      floor: 0.01,
      event: "collision",
      measure: after(`${b.id}.vx`),
    },
  ];
}

function atwoodReferences(pulley: Pulley, scene: LabScene): Reference[] {
  const g = scene.gravity;
  const { wheelMass } = pulley;
  const ideal = atwood(pulley, g);
  const a = ideal.acceleration;
  const massless = wheelMass === 0;
  const assumptions = [
    "Massless, inextensible rope that does not slip on the wheel.",
    massless
      ? "Massless wheel on a frictionless axle."
      : "The wheel is a uniform disc (I = M R² / 2) on a frictionless axle.",
    "The engine moves two rigid weights through a rope constraint; the reference checks that coupling and the integrator.",
  ];
  const early = (run: MotionRun) =>
    run.series.t.find((t) => t > 0 && t < run.stop.t);
  const read = (key: string) => (run: MotionRun) => {
    const t = early(run);
    return t === undefined ? undefined : valueAt(run, `${pulley.id}.${key}`, t);
  };
  const denominator = massless ? "(m₁ + m₂)" : "(m₁ + m₂ + M/2)";
  const list: Reference[] = [
    {
      id: `${pulley.id}.atwood.a`,
      target: pulley.id,
      label: "Acceleration",
      symbol: "a",
      unit: "m/s²",
      formula: `a = g (m₂ − m₁) / ${denominator}`,
      value: a,
      assumptions,
      tolerance: 1e-6,
      floor: 1e-6,
      measure: read("acceleration"),
    },
    {
      id: `${pulley.id}.atwood.T`,
      target: pulley.id,
      label: massless ? "Tension" : "Left tension",
      symbol: massless ? "T" : "T₁",
      unit: "N",
      formula: massless ? "T = 2 m₁ m₂ g / (m₁ + m₂)" : "T₁ = m₁ (g + a)",
      value: ideal.leftTension,
      assumptions,
      tolerance: 1e-6,
      floor: 1e-6,
      measure: read("tension"),
    },
  ];
  if (!massless)
    list.push({
      id: `${pulley.id}.atwood.T2`,
      target: pulley.id,
      label: "Right tension",
      symbol: "T₂",
      unit: "N",
      formula: "T₂ = m₂ (g − a)",
      value: ideal.rightTension,
      assumptions,
      tolerance: 1e-6,
      floor: 1e-6,
      measure: read("rightTension"),
    });
  if (a !== 0)
    list.push({
      id: `${pulley.id}.atwood.t`,
      target: pulley.id,
      label: "Time to land",
      symbol: "t",
      unit: "s",
      formula: "t = √(2 d / |a|)",
      value: Math.sqrt((2 * PULLEY_TRAVEL) / Math.abs(a)),
      assumptions: [
        ...assumptions,
        `The descending weight lands after d = ${PULLEY_TRAVEL.toFixed(2)} m of rope travel; the event resolves to one time step.`,
      ],
      tolerance: 0.01,
      floor: 1e-3,
      event: "pulley_stop",
      measure: (run) => eventTime(run, "pulley_stop", pulley.id),
    });
  return list;
}

/** Closed-form references that apply to the parts in a scene. */
export function referencesFor(scene: LabScene): Reference[] {
  const list: Reference[] = [];
  for (const part of scene.objects) {
    if (part.kind === "pulley") list.push(...atwoodReferences(part, scene));
    if (part.kind === "pendulum") list.push(...pendulumReferences(part, scene));
    if (part.kind === "spring") list.push(...springReferences(part));
    if (!isBody(part)) continue;
    const reason = disturbance(part, scene);
    const start = startingRamp(part, scene);
    if (start) {
      list.push(
        ...flag(
          part.kind === "block"
            ? inclineReferences(part, start.ramp, start.fraction, scene)
            : rollingReferences(part, start.ramp, start.fraction, scene),
          reason,
        ),
      );
      continue;
    }
    const height = part.y - bodyLowest(part, startRotation(part));
    const airborne = canLand(part, scene);
    if (part.force && !airborne && part.vx === 0 && part.vy === 0) {
      list.push(...pushReferences(part, scene));
      continue;
    }
    if (airborne) {
      const drag = part.force ? [] : dragReferences(part, height, scene);
      // A drag law that has a closed form replaces the drag-free flight.
      list.push(
        ...(drag.length
          ? drag
          : flag(projectileReferences(part, height, scene), reason)),
      );
      if (part.restitution > 0)
        list.push(...flag(bounceReferences(part, scene), reason));
    } else if (part.kind === "block")
      list.push(...flag(frictionReferences(part, scene), reason));
  }
  for (const [a, b] of headOnPairs(scene))
    list.push(
      ...flag(
        collisionReferences(a, b),
        disturbance(a, scene) ?? disturbance(b, scene),
      ),
    );
  return list;
}

/** Dashed theory curves for the probe series the references describe. */
export function curvesFor(scene: LabScene): TheoryCurve[] {
  const curves: TheoryCurve[] = [];
  const g = scene.gravity;
  const references = referencesFor(scene);
  // Curves follow only the references whose assumptions the scene meets.
  const find = (id: string) =>
    references.find((reference) => reference.id === id && !reference.broken);
  for (const part of scene.objects) {
    if (part.kind === "pulley") {
      const a = atwood(part, g).acceleration;
      const until = a === 0 ? 60 : Math.sqrt((2 * PULLEY_TRAVEL) / Math.abs(a));
      curves.push(
        { key: `${part.id}.speed`, at: (t) => a * t, until },
        { key: `${part.id}.displacement`, at: (t) => (a * t * t) / 2, until },
      );
    }
    if (part.kind === "pendulum") {
      const period = find(`${part.id}.pendulum.T0`);
      if (period && Math.abs(part.angle) <= SMALL_ANGLE) {
        const theta0 = radians(part.angle);
        const omega = (2 * Math.PI) / period.value;
        curves.push({
          key: `${part.id}.angle`,
          at: (t) => theta0 * Math.cos(omega * t),
          until: 60,
        });
      }
    }
    if (part.kind === "spring") {
      const { omega0, zeta } = springModes(part);
      if (part.offset !== 0 && zeta < 1) {
        const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
        const decay = zeta * omega0;
        curves.push({
          key: `${part.id}.displacement`,
          at: (t) =>
            part.offset *
            Math.exp(-decay * t) *
            (Math.cos(omegaD * t) + (decay / omegaD) * Math.sin(omegaD * t)),
          until: 60,
        });
      }
    }
    if (!isBody(part)) continue;
    const incline =
      find(`${part.id}.incline.a`) ?? find(`${part.id}.rolling.a`);
    if (incline)
      curves.push({
        key: `${part.id}.speed`,
        at: (t) => incline.value * t,
        until:
          (find(`${part.id}.incline.t`) ?? find(`${part.id}.rolling.t`))
            ?.value ?? 60,
      });
    const stop = find(`${part.id}.friction.t`);
    if (stop) {
      const v0 = Math.abs(part.vx);
      const deceleration = contactFriction(part, scene.floorFriction) * g;
      curves.push({
        key: `${part.id}.speed`,
        at: (t) => Math.max(0, v0 - deceleration * t),
        until: Math.min(stop.value, 60),
      });
    }
    const pushed = find(`${part.id}.push.v`);
    if (pushed && part.force) {
      const { a, v, mu } = pushMotion(part, scene);
      const { start, end } = part.force;
      const stopping = mu * g;
      curves.push({
        key: `${part.id}.speed`,
        at: (t) =>
          t < start
            ? 0
            : t < end
              ? Math.abs(a) * (t - start)
              : Math.max(0, Math.abs(v) - stopping * (t - end)),
        until: stopping > 0 ? end + Math.abs(v) / stopping : 60,
      });
    }
    const drop = find(`${part.id}.drag.v`);
    if (drop) {
      const { quadratic } = dragCoefficients(part, scene);
      const terminal = Math.sqrt((part.mass * g) / quadratic);
      const until = find(`${part.id}.drag.t`)?.value ?? 60;
      curves.push(
        {
          key: `${part.id}.vy`,
          at: (t) => -terminal * Math.tanh((g * t) / terminal),
          until,
        },
        {
          key: `${part.id}.y`,
          at: (t) =>
            part.y -
            (terminal ** 2 / g) * Math.log(Math.cosh((g * t) / terminal)),
          until,
        },
      );
    }
    const range = find(`${part.id}.drag.r`);
    if (range) {
      const k = scene.linearDrag / part.mass;
      const until = find(`${part.id}.drag.t`)?.value ?? 60;
      const grow = (t: number) => -Math.expm1(-k * t) / k;
      curves.push(
        {
          key: `${part.id}.x`,
          at: (t) => part.x + part.vx * grow(t),
          until,
        },
        {
          key: `${part.id}.y`,
          at: (t) => part.y + (part.vy + g / k) * grow(t) - (g * t) / k,
          until,
        },
        {
          key: `${part.id}.vy`,
          at: (t) => (part.vy + g / k) * Math.exp(-k * t) - g / k,
          until,
        },
      );
    }
    const flight = find(`${part.id}.projectile.t`);
    if (flight)
      curves.push(
        {
          key: `${part.id}.y`,
          at: (t) => part.y + part.vy * t - (g * t * t) / 2,
          until: flight.value,
        },
        {
          key: `${part.id}.vy`,
          at: (t) => part.vy - g * t,
          until: flight.value,
        },
        {
          key: `${part.id}.x`,
          at: (t) => part.x + part.vx * t,
          until: flight.value,
        },
      );
  }
  return curves;
}

/** Compares a reference with its measured value in a run. */
export function compare(reference: Reference, run?: MotionRun): Comparison {
  const relative = Math.abs(reference.value) > reference.floor;
  const measured = run ? reference.measure(run) : undefined;
  if (measured === undefined || !Number.isFinite(measured))
    return { reference, relative };
  const delta = relative
    ? (measured - reference.value) / Math.abs(reference.value)
    : measured - reference.value;
  const limit = relative ? reference.tolerance : reference.floor;
  return {
    reference,
    measured,
    delta,
    relative,
    within: Math.abs(delta) <= limit,
  };
}
