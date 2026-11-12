import { useCallback, useEffect, useRef, useState } from "react";
import type { LabScene } from "../scene";
import type { SweepPoint, SweepSpec } from "./sweep";
import type { SweepFit } from "./sweepFit";
import {
  localRunner,
  poolSize,
  runSweep,
  workerRunner,
  type PointRunner,
  type SweepRecord,
} from "./sweepPool";

export type SweepState = {
  scene: LabScene;
  spec: SweepSpec;
  /** Finished points in index order, streaming in while the sweep runs. */
  points: SweepPoint[];
  status: "running" | "complete" | "cancelled" | "failed";
  /** Present once the sweep has ended, complete or cancelled. */
  record?: SweepRecord;
  error?: string;
  runners: number;
  /** Counts sweeps started in this session, so views can reset per sweep. */
  serial: number;
  /** The latest fit to these points. */
  fit?: SweepFit;
};

/** Module workers where the browser has them; this thread otherwise. */
function makeRunners(count: number): PointRunner[] {
  if (typeof Worker === "undefined") return [localRunner()];
  return Array.from({ length: count }, workerRunner);
}

const insert = (points: SweepPoint[], point: SweepPoint) => {
  const next = [...points, point];
  next.sort((a, b) => a.index - b.index);
  return next;
};

/** Runs one sweep at a time on the worker pool, streaming points and allowing a cancel. */
export function useSweep() {
  const [state, setState] = useState<SweepState>();
  const controller = useRef<AbortController | null>(null);
  const serial = useRef(0);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const start = useCallback((scene: LabScene, spec: SweepSpec) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const runners = makeRunners(Math.min(poolSize(), spec.values.length));
    const mine = (update: (previous: SweepState) => SweepState) =>
      setState((previous) =>
        previous && controller.current === current
          ? update(previous)
          : previous,
      );
    setState({
      scene,
      spec,
      points: [],
      status: "running",
      runners: runners.length,
      serial: ++serial.current,
    });
    runSweep(scene, spec, {
      runners,
      signal: current.signal,
      onPoint: ({ point }) =>
        mine((previous) => ({
          ...previous,
          points: insert(previous.points, point),
        })),
    })
      .then(
        (record) =>
          mine((previous) => ({
            ...previous,
            points: record.points,
            status: record.status,
            record,
          })),
        (error: unknown) =>
          mine((previous) => ({
            ...previous,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })),
      )
      .finally(() => runners.forEach((runner) => runner.dispose()));
  }, []);

  const clear = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(undefined);
  }, []);

  const setFit = useCallback(
    (fit: SweepFit | undefined) =>
      setState((previous) => (previous ? { ...previous, fit } : previous)),
    [],
  );

  /** Shows a stored sweep, such as one restored from an experiment file. */
  const load = useCallback((record: SweepRecord, fit?: SweepFit) => {
    controller.current?.abort();
    controller.current = null;
    setState({
      scene: record.scene,
      spec: record.spec,
      points: record.points,
      status: record.status,
      record,
      runners: record.timing.runners,
      serial: ++serial.current,
      fit,
    });
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, start, cancel, clear, setFit, load };
}
