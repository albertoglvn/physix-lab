import { buildScene, SceneRequestError } from "../buildScene.ts";
import { parseScene, type LabScene } from "../scene.ts";
import {
  availableStops,
  defaultProtocol,
  EVENT_LABELS,
  MAX_TIME_LIMITS,
  SYSTEM,
  type Protocol,
  type Quantity,
} from "./probes.ts";
import { runProtocol, type MotionRun } from "./run.ts";
import { compare, CONTACT_MODEL, curvesFor, referencesFor } from "./theory.ts";

/**
 * Runs a Motion scene for a hosted caller, such as the ChatGPT plugin, and condenses the
 * `physix.run/1` record into what a chat can quote and plot: the events, the closed-form
 * comparisons, a summary of each plotted column and a few downsampled graphs.
 */
export const RUN_REQUEST_SCHEMA = "physix.run-request/1";
export const HOSTED_RUN_SCHEMA = "physix.hosted-run/1";
export const GRAPH_POINTS = { default: 120, min: 20, max: 400 } as const;
export const MAX_GRAPHS = 12;
export const MAX_EVENTS = 20;
export const MAX_REFERENCES = 16;

export class RunRequestError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "RunRequestError";
    this.field = field;
  }
}

/** One plot: shared time samples and one or more columns in the same unit. */
export type Graph = {
  id: string;
  title: string;
  target: string;
  unit: string;
  t: number[];
  series: {
    key: string;
    label: string;
    symbol: string;
    /** Values at `t`; `theory` holds the closed-form curve where one applies, else null. */
    values: number[];
    theory?: (number | null)[];
  }[];
};

export type ColumnSummary = {
  key: string;
  label: string;
  unit: string;
  start: number;
  end: number;
  min: number;
  max: number;
};

export type ReferenceResult = {
  id: string;
  target: string;
  label: string;
  symbol: string;
  unit: string;
  formula: string;
  theory: number;
  measured: number | null;
  /** Relative difference, or absolute when the theory value is near zero. */
  difference: number | null;
  relative: boolean;
  tolerance: number;
  within: boolean | null;
  assumptions: string[];
  broken?: string;
};

export type HostedRun = {
  schema: typeof HOSTED_RUN_SCHEMA;
  source: "rapier";
  scene: LabScene;
  defaults?: Record<string, string[]>;
  protocol: { stop: Protocol["stop"]; max_time_s: number };
  run: {
    id: string;
    engine: MotionRun["engine"];
    time_step_s: number;
    sample_rate_hz: number;
    samples: number;
    stop: { reason: MotionRun["stop"]["reason"]; t: number; event?: string };
    timing: { wall_ms: number; boundary: string };
  };
  events: { type: string; label: string; target: string; t: number }[];
  events_omitted: number;
  /** The contact law every reference assumes; stated once rather than per reference. */
  contact_model: string;
  references: ReferenceResult[];
  references_omitted: number;
  summary: ColumnSummary[];
  graphs: { id: string; title: string; unit: string; keys: string[] }[];
};

const REQUEST_KEYS = ["request", "scene", "stop", "max_time_s", "points"];

/** Graph choices per part kind: id suffix, title, columns. Columns share one unit. */
const BODY_GRAPHS = [
  ["position", "Position", ["x", "y"]],
  ["velocity", "Velocity", ["vx", "vy", "speed"]],
  ["contact", "Contact forces", ["normal", "friction"]],
] as const;
const GRAPHS_BY_KIND: Record<
  string,
  readonly (readonly [string, string, readonly string[]])[]
> = {
  block: BODY_GRAPHS,
  ball: BODY_GRAPHS,
  cylinder: BODY_GRAPHS,
  pulley: [
    ["displacement", "Rope displacement", ["displacement"]],
    ["speed", "Rope speed", ["speed"]],
    ["tension", "Rope tension", ["tension", "rightTension"]],
  ],
  pendulum: [
    ["angle", "Angle", ["angle"]],
    ["omega", "Angular velocity", ["omega"]],
    ["tension", "Link tension", ["tension"]],
  ],
  spring: [
    ["displacement", "Displacement from equilibrium", ["displacement"]],
    ["force", "Spring force", ["force"]],
  ],
};
const SYSTEM_GRAPHS = [
  ["energy", "Energy", ["kinetic", "potential", "energy"]],
] as const;

const round = (value: number) =>
  Number.isFinite(value) ? Number(value.toPrecision(6)) : value;

/** Places a scene-request field path under `request`. */
const requestField = (field = "request") =>
  field === "request" || field.startsWith("request.")
    ? field
    : `request.${field}`;

export type RunRequest = {
  scene: LabScene;
  defaults?: Record<string, string[]>;
  protocol: Protocol;
  points: number;
};

/** Validates a `physix.run-request/1` and resolves its scene and stop. */
export function parseRunRequest(input: unknown): RunRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new RunRequestError(
      "The run request must be an object.",
      "arguments",
    );
  const args = input as Record<string, unknown>;
  for (const key of Object.keys(args))
    if (!REQUEST_KEYS.includes(key))
      throw new RunRequestError(
        `Unknown field "${key}"; use ${REQUEST_KEYS.join(", ")}.`,
        key,
      );
  if ((args.request === undefined) === (args.scene === undefined))
    throw new RunRequestError(
      "Give exactly one of request (a scene request) or scene (a scene from build_scene).",
      "request",
    );
  let scene: LabScene;
  let defaults: Record<string, string[]> | undefined;
  if (args.request !== undefined) {
    try {
      ({ scene, defaults } = buildScene(args.request));
    } catch (error) {
      if (error instanceof SceneRequestError)
        throw new RunRequestError(error.message, requestField(error.field));
      throw error;
    }
  } else {
    try {
      scene = parseScene(args.scene);
    } catch (error) {
      throw new RunRequestError(
        error instanceof Error ? error.message : String(error),
        "scene",
      );
    }
  }

  const protocol = defaultProtocol(scene);
  const stops = ["time", ...availableStops(scene)];
  if (args.stop !== undefined) {
    if (typeof args.stop !== "string" || !stops.includes(args.stop))
      throw new RunRequestError(
        `This scene can stop on ${stops.join(", ")}.`,
        "stop",
      );
    protocol.stop = args.stop as Protocol["stop"];
  }
  if (args.max_time_s !== undefined) {
    const [min, max] = MAX_TIME_LIMITS;
    if (
      typeof args.max_time_s !== "number" ||
      !Number.isFinite(args.max_time_s) ||
      args.max_time_s < min ||
      args.max_time_s > max
    )
      throw new RunRequestError(
        `max_time_s must be between ${min} and ${max} s.`,
        "max_time_s",
      );
    protocol.maxTime = args.max_time_s;
  }
  let points: number = GRAPH_POINTS.default;
  if (args.points !== undefined) {
    if (
      !Number.isInteger(args.points) ||
      (args.points as number) < GRAPH_POINTS.min ||
      (args.points as number) > GRAPH_POINTS.max
    )
      throw new RunRequestError(
        `points must be an integer from ${GRAPH_POINTS.min} to ${GRAPH_POINTS.max}.`,
        "points",
      );
    points = args.points as number;
  }
  return { scene, defaults, protocol, points };
}

/** Indices of at most `count` samples spread evenly over `length`, with the last one. */
export function sampleIndices(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

function summarize(quantity: Quantity, values: number[]): ColumnSummary {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return {
    key: quantity.key,
    label: quantity.label,
    unit: quantity.unit,
    start: round(values[0]),
    end: round(values[values.length - 1]),
    min: round(min),
    max: round(max),
  };
}

/** A column that never leaves zero adds nothing to a chart. */
const flat = (values: number[]) =>
  values.every((value) => Math.abs(value) < 1e-9);

function chooseGraphs(scene: LabScene, run: MotionRun, points: number) {
  const byKey = new Map(run.quantities.map((q) => [q.key, q]));
  const curves = new Map(curvesFor(scene).map((curve) => [curve.key, curve]));
  const indices = sampleIndices(run.series.t.length, points);
  const t = indices.map((i) => round(run.series.t[i]));
  const graphs: Graph[] = [];
  const summary: ColumnSummary[] = [];
  const plan: [
    string,
    string,
    readonly (readonly [string, string, readonly string[]])[],
  ][] = [
    ...scene.objects
      .filter((part) => GRAPHS_BY_KIND[part.kind])
      .map(
        (part) =>
          [part.id, part.id, GRAPHS_BY_KIND[part.kind]] as [
            string,
            string,
            typeof BODY_GRAPHS,
          ],
      ),
    [SYSTEM, "System", SYSTEM_GRAPHS],
  ];
  for (const [target, name, choices] of plan) {
    for (const [suffix, title, columns] of choices) {
      if (graphs.length >= MAX_GRAPHS) break;
      const series: Graph["series"] = [];
      let unit = "";
      for (const column of columns) {
        const quantity = byKey.get(`${target}.${column}`);
        const values = quantity && run.series.columns[quantity.key];
        if (!quantity || !values?.length || flat(values)) continue;
        unit = quantity.unit;
        summary.push(summarize(quantity, values));
        const curve = curves.get(quantity.key);
        series.push({
          key: quantity.key,
          label: quantity.label,
          symbol: quantity.symbol,
          values: indices.map((i) => round(values[i])),
          ...(curve && {
            theory: t.map((time) =>
              time <= curve.until ? round(curve.at(time)) : null,
            ),
          }),
        });
      }
      if (series.length)
        graphs.push({
          id: `${target}.${suffix}`,
          title: target === SYSTEM ? title : `${name}: ${title.toLowerCase()}`,
          target,
          unit,
          t,
          series,
        });
    }
  }
  return { graphs, summary };
}

/** Runs a parsed request with the lab's engine and condenses the record. */
export async function simulateScene({
  scene,
  defaults,
  protocol,
  points,
}: RunRequest): Promise<{ result: HostedRun; graphs: Graph[] }> {
  const run = await runProtocol(scene, protocol);
  const { graphs, summary } = chooseGraphs(scene, run, points);
  const all = referencesFor(scene);
  const references = all
    .slice(0, MAX_REFERENCES)
    .map((reference): ReferenceResult => {
      const outcome = compare(reference, run);
      return {
        id: reference.id,
        target: reference.target,
        label: reference.label,
        symbol: reference.symbol,
        unit: reference.unit,
        formula: reference.formula,
        theory: round(reference.value),
        measured:
          outcome.measured === undefined ? null : round(outcome.measured),
        difference: outcome.delta === undefined ? null : round(outcome.delta),
        relative: outcome.relative,
        tolerance: outcome.relative ? reference.tolerance : reference.floor,
        within: outcome.within ?? null,
        assumptions: reference.assumptions.filter(
          (line) => line !== CONTACT_MODEL,
        ),
        ...(reference.broken && { broken: reference.broken }),
      };
    });
  return {
    graphs,
    result: {
      schema: HOSTED_RUN_SCHEMA,
      source: "rapier",
      scene,
      ...(defaults && { defaults }),
      protocol: { stop: protocol.stop, max_time_s: protocol.maxTime },
      run: {
        id: run.id,
        engine: run.engine,
        time_step_s: run.inputs.timeStep,
        sample_rate_hz: run.inputs.rate,
        samples: run.series.t.length,
        stop: {
          reason: run.stop.reason,
          t: round(run.stop.t),
          ...(run.stop.event && {
            event: `${run.stop.event.type} (${run.stop.event.target})`,
          }),
        },
        timing: {
          wall_ms: round(run.timing.wallMs),
          boundary: run.timing.boundary,
        },
      },
      events: run.events.slice(0, MAX_EVENTS).map((event) => ({
        type: event.type,
        label: EVENT_LABELS[event.type],
        target: event.target,
        t: round(event.t),
      })),
      events_omitted: Math.max(0, run.events.length - MAX_EVENTS),
      contact_model: CONTACT_MODEL,
      references,
      references_omitted: all.length - references.length,
      summary,
      graphs: graphs.map(({ id, title, unit, series }) => ({
        id,
        title,
        unit,
        keys: series.map((s) => s.key),
      })),
    },
  };
}

/** The JSON Schema of a run request; `request` is a `physix.scene-request/1`. */
export function runRequestSchema(sceneRequest: object) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      request: {
        ...sceneRequest,
        description:
          "A scene request, as for build_scene. Give this or scene, not both.",
      },
      scene: {
        type: "object",
        description:
          "A complete physix.lab/2 scene, such as the scene a build_scene result returned.",
      },
      stop: {
        type: "string",
        enum: ["time", ...Object.keys(EVENT_LABELS)],
        description:
          "The event that ends the run. Defaults to the lab's choice for the scene: the pulley stop, leaving a ramp, the first bounce, landing, then rest.",
      },
      max_time_s: {
        type: "number",
        minimum: MAX_TIME_LIMITS[0],
        maximum: MAX_TIME_LIMITS[1],
        description:
          "Time limit of the run in seconds. Defaults to 10 s, or long enough for a head-on collision to settle.",
      },
      points: {
        type: "integer",
        minimum: GRAPH_POINTS.min,
        maximum: GRAPH_POINTS.max,
        description: `Samples per plotted graph, default ${GRAPH_POINTS.default}.`,
      },
    },
  };
}
