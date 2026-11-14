import {
  parseProtocol,
  sceneQuantities,
  type Protocol,
} from "../motion/probes";
import {
  canonicalJson,
  RUN_SCHEMA,
  sha256,
  type MotionRun,
} from "../motion/run";
import {
  parseSweepRecord,
  parseStoredFit,
  type StoredFit,
} from "../motion/sweepExport";
import type { SweepRecord } from "../motion/sweepPool";
import { parseScene, type LabScene } from "../scene";

export const EXPERIMENT_SCHEMA = "physix.experiment/1";

/**
 * A `physix.experiment/1` file: the Motion scene, its protocol and the runs made from it.
 * A sweep, with the fit made on it, rides along when there is one (LAB_PLAN.md §4.3).
 */
export type Experiment = {
  schema: typeof EXPERIMENT_SCHEMA;
  id: string;
  name: string;
  studies: { motion: { scene: LabScene } };
  probes: { id: string; target: string; quantity: string; rate: number }[];
  protocol: Protocol;
  runs: MotionRun[];
  units: { display: "si" };
  /** The last sweep and its fit; a sweep keeps its own base scene and identity. */
  sweep?: { record: SweepRecord; fit?: StoredFit };
};

export async function makeExperiment(
  scene: LabScene,
  protocol: Protocol,
  runs: MotionRun[],
  sweep?: Experiment["sweep"],
): Promise<Experiment> {
  const rate = runs[0]?.inputs.rate ?? 60;
  return {
    schema: EXPERIMENT_SCHEMA,
    id: await sha256(
      canonicalJson({ schema: EXPERIMENT_SCHEMA, scene, protocol }),
    ),
    name: scene.name,
    studies: { motion: { scene } },
    probes: sceneQuantities(scene).map(({ key, target }) => ({
      id: key,
      target,
      quantity: key.slice(target.length + 1),
      rate,
    })),
    protocol,
    runs,
    units: { display: "si" },
    ...(sweep ? { sweep } : {}),
  };
}

/** JSON text of an experiment; NaN samples become null and read back as NaN. */
export const experimentJson = (experiment: Experiment) =>
  JSON.stringify(experiment, null, 2) + "\n";

function parseRun(input: unknown, index: number): MotionRun {
  if (typeof input !== "object" || input === null)
    throw new Error(`Run ${index + 1} must be an object.`);
  const run = input as MotionRun;
  if (run.schema !== RUN_SCHEMA)
    throw new Error(`Run ${index + 1} must use ${RUN_SCHEMA}.`);
  const times = run.series?.t;
  if (!Array.isArray(times) || typeof run.series.columns !== "object")
    throw new Error(`Run ${index + 1} has no probe series.`);
  const columns = Object.fromEntries(
    Object.entries(run.series.columns).map(([key, values]) => {
      if (!Array.isArray(values) || values.length !== times.length)
        throw new Error(`Run ${index + 1} column ${key} has the wrong length.`);
      return [
        key,
        values.map((value: unknown) =>
          typeof value === "number" ? value : Number.NaN,
        ),
      ];
    }),
  );
  return {
    ...run,
    inputs: {
      ...run.inputs,
      scene: parseScene(run.inputs?.scene),
      protocol: parseProtocol(run.inputs?.protocol),
    },
    series: { t: times, columns },
  };
}

/** Validates an experiment file and restores its scene, protocol and runs. */
export function parseExperiment(input: unknown): Experiment {
  if (typeof input !== "object" || input === null)
    throw new Error("The experiment must be an object.");
  const file = input as Record<string, unknown>;
  if (file.schema !== EXPERIMENT_SCHEMA)
    throw new Error(`Expected an ${EXPERIMENT_SCHEMA} file.`);
  const studies = file.studies as Experiment["studies"] | undefined;
  const scene = parseScene(studies?.motion?.scene);
  const protocol = parseProtocol(file.protocol);
  const runs = Array.isArray(file.runs) ? file.runs.map(parseRun) : [];
  const stored = file.sweep as
    { record?: unknown; fit?: unknown } | undefined | null;
  const sweep = stored
    ? {
        record: parseSweepRecord(stored.record),
        ...(stored.fit ? { fit: parseStoredFit(stored.fit) } : {}),
      }
    : undefined;
  const { sweep: _sweep, ...rest } = file as Experiment;
  void _sweep;
  return {
    ...rest,
    name: scene.name,
    studies: { motion: { scene } },
    protocol,
    runs,
    ...(sweep ? { sweep } : {}),
  };
}

export const isExperiment = (input: unknown) =>
  typeof input === "object" &&
  input !== null &&
  (input as { schema?: unknown }).schema === EXPERIMENT_SCHEMA;
