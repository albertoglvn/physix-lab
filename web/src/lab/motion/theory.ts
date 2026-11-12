import {
  radians,
  type Block,
  type LabObject,
  type LabScene,
  type Pulley,
  type Ramp,
} from "../scene";
import { PULLEY_TRAVEL } from "../simulation";
import {
  CONTACT_GAP,
  leaveFraction,
  lowestOffset,
  startingRamp,
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
  "One Coulomb coefficient per contact pair (static equals kinetic), the product of the two parts' coefficients; blocks use 1.";

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

const sharesPath = (
  block: Block,
  others: LabObject[],
  from: number,
  to: number,
): LabObject | undefined =>
  others.find((part) => {
    if (part.id === block.id || part.kind === "pulley") return false;
    const extent = part.kind === "block" ? part.size / 2 : part.length / 2;
    const depth = part.kind === "block" ? part.size / 2 : part.width / 2;
    const [low, high] = from < to ? [from, to] : [to, from];
    return (
      part.x + extent > low - block.size / 2 &&
      part.x - extent < high + block.size / 2 &&
      Math.abs(part.z - block.z) < depth + block.size / 2
    );
  });

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
  const neighbour = scene.objects.find(
    (part) =>
      part.kind === "block" &&
      part.id !== block.id &&
      startingRamp(part, scene)?.ramp.id === ramp.id,
  );
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
  block: Block,
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
    "Contact is detected to one step, as the lowest corner comes within 5 mm of the floor.",
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
  const { leftMass: m1, rightMass: m2 } = pulley;
  const assumptions = [
    "Massless, inextensible rope over a massless, frictionless wheel.",
    "The engine uses this ideal model, so the difference checks the bookkeeping only.",
  ];
  const early = (run: MotionRun) =>
    run.series.t.find((t) => t > 0 && t < run.stop.t);
  const read = (key: string) => (run: MotionRun) => {
    const t = early(run);
    return t === undefined ? undefined : valueAt(run, `${pulley.id}.${key}`, t);
  };
  return [
    {
      id: `${pulley.id}.atwood.a`,
      target: pulley.id,
      label: "Acceleration",
      symbol: "a",
      unit: "m/s²",
      formula: "a = g (m₂ − m₁) / (m₁ + m₂)",
      value: (g * (m2 - m1)) / (m1 + m2),
      assumptions,
      tolerance: 1e-6,
      floor: 1e-6,
      measure: read("acceleration"),
    },
    {
      id: `${pulley.id}.atwood.T`,
      target: pulley.id,
      label: "Tension",
      symbol: "T",
      unit: "N",
      formula: "T = 2 m₁ m₂ g / (m₁ + m₂)",
      value: (2 * m1 * m2 * g) / (m1 + m2),
      assumptions,
      tolerance: 1e-6,
      floor: 1e-6,
      measure: read("tension"),
    },
  ];
}

/** Closed-form references that apply to the parts in a scene. */
export function referencesFor(scene: LabScene): Reference[] {
  const list: Reference[] = [];
  for (const part of scene.objects) {
    if (part.kind === "pulley") list.push(...atwoodReferences(part, scene));
    if (part.kind !== "block") continue;
    const start = startingRamp(part, scene);
    if (start) {
      list.push(...inclineReferences(part, start.ramp, start.fraction, scene));
      continue;
    }
    const halfAngle = radians(part.rotation) / 2;
    const height =
      part.y -
      lowestOffset(part.size, {
        x: 0,
        y: 0,
        z: Math.sin(halfAngle),
        w: Math.cos(halfAngle),
      });
    if (height > CONTACT_GAP)
      list.push(...projectileReferences(part, height, scene));
    else list.push(...frictionReferences(part, scene));
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
      const a =
        (g * (part.rightMass - part.leftMass)) /
        (part.rightMass + part.leftMass);
      const until = a === 0 ? 60 : Math.sqrt((2 * PULLEY_TRAVEL) / Math.abs(a));
      curves.push(
        { key: `${part.id}.speed`, at: (t) => a * t, until },
        { key: `${part.id}.displacement`, at: (t) => (a * t * t) / 2, until },
      );
    }
    if (part.kind !== "block") continue;
    const incline = find(`${part.id}.incline.a`);
    if (incline)
      curves.push({
        key: `${part.id}.speed`,
        at: (t) => incline.value * t,
        until: find(`${part.id}.incline.t`)?.value ?? 60,
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
