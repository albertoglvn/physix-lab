import { ellipticK, meanPeriod } from "../data/period";
import {
  bodyHalf,
  isBody,
  radians,
  type Ball,
  type Block,
  type Body,
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
  CONTACT_GAP,
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
  "One Coulomb coefficient per contact pair (static equals kinetic), the product of the two parts' coefficients; blocks and balls use 1.";

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
  const mu = ramp.friction;
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
 * A solid ball released on a ramp rolls without slipping while μ ≥ (2/7) tan θ, at
 * a = (5/7) g sin θ; below that it slips, and kinetic friction gives g (sin θ − μ cos θ).
 */
function rollingReferences(
  ball: Ball,
  ramp: Ramp,
  fraction: number,
  scene: LabScene,
): Reference[] {
  const g = scene.gravity;
  const tilt = radians(ramp.angle);
  const mu = ramp.friction;
  const rolls = mu >= (2 / 7) * Math.tan(tilt);
  const a = rolls
    ? (5 / 7) * g * Math.sin(tilt)
    : g * (Math.sin(tilt) - mu * Math.cos(tilt));
  const distance =
    ((leaveFraction(ball, ramp) - fraction) * ramp.length) / Math.cos(tilt);
  const neighbour = rampNeighbour(ball, ramp, scene);
  const broken = neighbour ? `${neighbour.id} shares ${ramp.id}.` : undefined;
  const assumptions = [
    `Starts at rest on ${ramp.id}, ${ramp.angle.toFixed(0)}° with μ = ${mu}.`,
    rolls
      ? "Rolls without slipping, since μ ≥ (2/7) tan θ; a solid sphere, I = (2/5) m r²."
      : "Slips throughout, since μ < (2/7) tan θ; kinetic friction acts at the contact.",
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
      formula: rolls ? "a = (5/7) g sin θ" : "a = g (sin θ − μ cos θ)",
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
  const mu = scene.floorFriction;
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

function projectileReferences(
  block: Body,
  height: number,
  scene: LabScene,
): Reference[] {
  const g = scene.gravity;
  const fall = Math.sqrt((2 * height) / g);
  const range = Math.abs(block.vx) * fall;
  const obstacle = sharesPath(
    block,
    scene.objects.filter((part) => part.kind === "ramp"),
    block.x,
    block.x + Math.sign(block.vx || 1) * range,
  );
  const broken = obstacle ? `${obstacle.id} lies under the path.` : undefined;
  const assumptions = [
    `Launched horizontally at ${block.vx} m/s from ${height.toFixed(2)} m above the floor.`,
    "No air drag; uniform gravity; no spin.",
    `Contact is detected to one step, as the lowest ${block.kind === "ball" ? "point" : "corner"} comes within 5 mm of the floor.`,
  ];
  const landing = (run: MotionRun) => eventTime(run, "floor_contact", block.id);
  return [
    {
      id: `${block.id}.projectile.t`,
      target: block.id,
      label: "Flight time",
      symbol: "t",
      unit: "s",
      formula: "t = √(2h / g)",
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
      formula: "R = |vₓ| √(2h / g)",
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
    const start = startingRamp(part, scene);
    if (start) {
      list.push(
        ...(part.kind === "ball"
          ? rollingReferences(part, start.ramp, start.fraction, scene)
          : inclineReferences(part, start.ramp, start.fraction, scene)),
      );
      continue;
    }
    const height = part.y - bodyLowest(part, startRotation(part));
    if (height > CONTACT_GAP)
      list.push(...projectileReferences(part, height, scene));
    else if (part.kind === "block")
      list.push(...frictionReferences(part, scene));
  }
  return list;
}

/** Dashed theory curves for the probe series the references describe. */
export function curvesFor(scene: LabScene): TheoryCurve[] {
  const curves: TheoryCurve[] = [];
  const g = scene.gravity;
  const references = referencesFor(scene);
  const find = (id: string) =>
    references.find((reference) => reference.id === id);
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
      const deceleration = scene.floorFriction * g;
      curves.push({
        key: `${part.id}.speed`,
        at: (t) => Math.max(0, v0 - deceleration * t),
        until: Math.min(stop.value, 60),
      });
    }
    const flight = find(`${part.id}.projectile.t`);
    if (flight)
      curves.push(
        {
          key: `${part.id}.y`,
          at: (t) => part.y - (g * t * t) / 2,
          until: flight.value,
        },
        { key: `${part.id}.vy`, at: (t) => -g * t, until: flight.value },
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
