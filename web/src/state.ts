/** Shared app state: the in-browser ensemble (loaded once) and the local API status. */

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api/client";
import { Engine } from "./inference/engine";

export type EngineState =
  | { status: "idle" | "loading"; progress: number; engine: null; error: null }
  | { status: "ready"; progress: 1; engine: Engine; error: null }
  | { status: "error"; progress: number; engine: null; error: string };

let engineState: EngineState = {
  status: "idle",
  progress: 0,
  engine: null,
  error: null,
};
const listeners = new Set<() => void>();

function setEngineState(next: EngineState): void {
  engineState = next;
  listeners.forEach((l) => l());
}

export function ensureEngine(): void {
  if (engineState.status !== "idle") return;
  setEngineState({ status: "loading", progress: 0, engine: null, error: null });
  Engine.load("models/", (done, total) => {
    if (engineState.status === "loading")
      setEngineState({ ...engineState, progress: total ? done / total : 0 });
  })
    .then((engine) =>
      setEngineState({ status: "ready", progress: 1, engine, error: null }),
    )
    .catch((err: unknown) =>
      setEngineState({
        status: "error",
        progress: 0,
        engine: null,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

export function useEngine(): EngineState {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => engineState,
  );
  useEffect(ensureEngine, []);
  return state;
}

export interface Health {
  online: boolean;
  modelId: string | null;
  solver: string | null;
  checked: boolean;
}

/** Polls `/api/health` every few seconds so the UI can tell whether FEM checks are available. */
export function useHealth(intervalMs = 5000): Health {
  const [health, setHealth] = useState<Health>({
    online: false,
    modelId: null,
    solver: null,
    checked: false,
  });
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    const check = () =>
      api
        .health(ctl.signal)
        .then((h) => {
          if (alive)
            setHealth({
              online: true,
              modelId: h.model_id,
              solver: `${h.solver.name} ${h.solver.version}`,
              checked: true,
            });
        })
        .catch(() => {
          if (alive)
            setHealth({
              online: false,
              modelId: null,
              solver: null,
              checked: true,
            });
        });
    check();
    const id = window.setInterval(check, intervalMs);
    return () => {
      alive = false;
      ctl.abort();
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return health;
}

/** Current `location.hash` route, e.g. "/studio". */
export function useRoute(): string {
  const read = () =>
    (window.location.hash.replace(/^#/, "") || "/").split("?")[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
