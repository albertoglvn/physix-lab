import {
  isBody,
  springEquilibrium,
  type LabObject,
  type LabScene,
} from "../scene";
import {
  initialBlockState,
  initialPulleyState,
  type Simulation,
} from "../simulation";

export type Reading = {
  label: string;
  short: string;
  value: number;
  unit: string;
};

/** Readings for the dock: the run time plus the selected part's state, in SI. */
export function measure(
  scene: LabScene,
  object: LabObject | undefined,
  simulation: Simulation | undefined,
  time: number,
): Reading[] {
  const items: Reading[] = [
    { label: "Time", short: "t", value: time, unit: "s" },
  ];
  if (object?.kind === "pendulum") {
    const { position, velocity, angularVelocity } =
      simulation?.block(object.id) ?? initialBlockState(object, scene.gravity);
    const theta = Math.atan2(
      position.x - object.x,
      object.pivotHeight - position.y,
    );
    items.push(
      {
        label: "Angle",
        short: "θ",
        value: (theta * 180) / Math.PI,
        unit: "°",
      },
      {
        label: "Angular velocity",
        short: "ω",
        value: angularVelocity?.z ?? 0,
        unit: "rad/s",
      },
      {
        label: "Bob speed",
        short: "v",
        value: Math.hypot(velocity.x, velocity.y, velocity.z),
        unit: "m/s",
      },
    );
  } else if (object?.kind === "spring") {
    const { position, velocity } =
      simulation?.block(object.id) ?? initialBlockState(object, scene.gravity);
    items.push(
      {
        label: "Displacement",
        short: "u",
        value: position.y - springEquilibrium(object, scene.gravity),
        unit: "m",
      },
      { label: "Y velocity", short: "vy", value: velocity.y, unit: "m/s" },
      { label: "Height", short: "h", value: position.y, unit: "m" },
    );
  } else if (object && isBody(object)) {
    const { position, velocity } =
      simulation?.block(object.id) ?? initialBlockState(object);
    items.push(
      {
        label: "Speed",
        short: "v",
        value: Math.hypot(velocity.x, velocity.y, velocity.z),
        unit: "m/s",
      },
      { label: "Height", short: "h", value: position.y, unit: "m" },
      { label: "X position", short: "x", value: position.x, unit: "m" },
    );
  } else if (object?.kind === "pulley") {
    const state =
      simulation?.pulley(object.id) ??
      initialPulleyState(object, scene.gravity);
    items.push(
      {
        label: "Rope speed",
        short: "v",
        value: Math.abs(state.speed),
        unit: "m/s",
      },
      {
        label: "Acceleration",
        short: "a",
        value: state.acceleration,
        unit: "m/s²",
      },
      {
        label: state.taut ? "Left tension" : "Rope slack",
        short: "T",
        value: state.tension,
        unit: "N",
      },
    );
  } else {
    items.push({
      label: "Gravity",
      short: "g",
      value: scene.gravity,
      unit: "m/s²",
    });
  }
  return items;
}

/** The single collapsed dock line, such as `t 1.42 s · v 3.18 m/s · h 0.52 m`. */
export function summarize(readings: Reading[]): string {
  return readings
    .slice(0, 3)
    .map(
      ({ short, value, unit }) =>
        `${short} ${Number.isFinite(value) ? value.toFixed(2) : "—"} ${unit}`,
    )
    .join(" · ");
}
