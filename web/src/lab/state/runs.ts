/**
 * Run history (LAB_PLAN.md §4.3, Run history and comparison). Finished runs are kept in
 * IndexedDB per experiment, newest first; one may be pinned as the baseline, and the dock
 * overlays chosen runs on the live plot. Storage can be missing or refuse writes in private
 * windows and previews, so the history falls back to memory for the session.
 *
 * History is keyed by the experiment's name rather than its identity: the identity hashes
 * the scene and protocol, so every edit would start an empty history and a comparison could
 * only ever hold identical runs.
 */
import { useCallback, useEffect, useState } from "react";
import { formatStep } from "../data/methods";
import type { Protocol } from "../motion/probes";
import { RUN_SCHEMA, type MotionRun } from "../motion/run";
import type { LabScene } from "../scene";

export type SavedRun = {
  run: MotionRun;
  /** Milliseconds since the epoch when the run was kept. */
  savedAt: number;
  pinned: boolean;
};

/** Runs kept per experiment; the oldest unpinned run goes first. */
export const HISTORY_LIMIT = 30;
/** Series on the plot at once, the live run included, one per data-palette colour. */
export const COMPARE_LIMIT = 6;

export const DB_NAME = "physix-lab";
const STORE_NAME = "runs";

export const historyKey = (scene: LabScene) => `motion:${scene.name}`;

/** Adds a run at the front, replacing an earlier copy, and trims the oldest unpinned runs. */
export function addRun(
  runs: SavedRun[],
  run: MotionRun,
  savedAt: number,
  limit = HISTORY_LIMIT,
): SavedRun[] {
  const earlier = runs.find((entry) => entry.run.id === run.id);
  const next = [
    { run, savedAt, pinned: earlier?.pinned ?? false },
    ...runs.filter((entry) => entry.run.id !== run.id),
  ];
  for (let index = next.length - 1; next.length > limit && index >= 0; index--)
    if (!next[index].pinned) next.splice(index, 1);
  return next;
}

/** Merges runs kept elsewhere into a history, keeping the newer copy of each run. */
export function mergeRuns(stored: SavedRun[], added: SavedRun[]): SavedRun[] {
  let merged = stored;
  for (const entry of [...added].sort((a, b) => a.savedAt - b.savedAt)) {
    const pinned = entry.pinned;
    merged = addRun(merged, entry.run, entry.savedAt);
    if (pinned) merged = pinRun(merged, entry.run.id, true);
  }
  return merged.sort((a, b) => b.savedAt - a.savedAt);
}

export const removeRun = (runs: SavedRun[], id: string) =>
  runs.filter((entry) => entry.run.id !== id);

/** Pins one run as the baseline, unpinning any other; `pinned` false clears it. */
export function pinRun(
  runs: SavedRun[],
  id: string,
  pinned = !runs.find((entry) => entry.run.id === id)?.pinned,
): SavedRun[] {
  return runs.map((entry) => ({
    ...entry,
    pinned: entry.run.id === id ? pinned : pinned ? false : entry.pinned,
  }));
}

const significant = (value: number) => String(Number(value.toPrecision(4)));

function formatInput(value: unknown): string {
  if (value === undefined || value === null) return "unset";
  if (typeof value === "number") return significant(value);
  return String(value);
}

/** Leaf values of a scene part by readable path, such as `position x`. */
function flatten(
  value: unknown,
  path: string,
  out: Map<string, unknown>,
): Map<string, unknown> {
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      if (key !== "id" && key !== "kind")
        flatten(item, path ? `${path} ${key}` : key, out);
  } else out.set(path, value);
  return out;
}

const SCENE_FIELDS: [keyof LabScene, string][] = [
  ["gravity", "g"],
  ["floorFriction", "floor μ"],
  ["airDensity", "air ρ"],
  ["linearDrag", "linear drag"],
];

/**
 * How a stored run's inputs differ from the current scene, in the stored run's values:
 * `block-1 mass 3` means the stored run used 3 kg where the scene now has something else.
 */
export function inputDifferences(
  inputs: MotionRun["inputs"],
  current: {
    scene: LabScene;
    protocol: Protocol;
    timeStep: number;
    rate: number;
  },
): string[] {
  const differences: string[] = [];
  const { scene } = inputs;
  for (const [field, label] of SCENE_FIELDS)
    if (scene[field] !== current.scene[field])
      differences.push(`${label} ${formatInput(scene[field])}`);
  const now = new Map(current.scene.objects.map((part) => [part.id, part]));
  const then = new Map(scene.objects.map((part) => [part.id, part]));
  for (const part of scene.objects) {
    const other = now.get(part.id);
    if (!other) {
      differences.push(`with ${part.id}`);
      continue;
    }
    if (other.kind !== part.kind) {
      differences.push(`${part.id} a ${part.kind}`);
      continue;
    }
    const before = flatten(part, "", new Map());
    const after = flatten(other, "", new Map());
    for (const key of new Set([...before.keys(), ...after.keys()]))
      if (before.get(key) !== after.get(key))
        differences.push(`${part.id} ${key} ${formatInput(before.get(key))}`);
  }
  for (const part of current.scene.objects)
    if (!then.has(part.id)) differences.push(`without ${part.id}`);
  if (inputs.protocol.stop !== current.protocol.stop)
    differences.push(
      inputs.protocol.stop === "time"
        ? "stop on time"
        : `stop on ${inputs.protocol.stop}`,
    );
  if (inputs.protocol.maxTime !== current.protocol.maxTime)
    differences.push(`max ${significant(inputs.protocol.maxTime)} s`);
  if (inputs.timeStep !== current.timeStep)
    differences.push(`Δt ${formatStep(inputs.timeStep)}`);
  if (inputs.rate !== current.rate) differences.push(`${inputs.rate} Hz`);
  return differences;
}

/** A short chip label for a stored run: its first two differences, or `Same inputs`. */
export function runLabel(differences: string[]): string {
  if (!differences.length) return "Same inputs";
  const shown = differences.slice(0, 2).join(", ");
  return differences.length > 2 ? `${shown} +${differences.length - 2}` : shown;
}

/** The stored runs to overlay: the baseline first, then the chosen runs, live run excluded. */
export function overlaidRuns(
  runs: SavedRun[],
  compared: string[],
  currentId?: string,
): SavedRun[] {
  const byId = new Map(runs.map((entry) => [entry.run.id, entry]));
  const baseline = runs.find((entry) => entry.pinned);
  const ids = [
    ...(baseline ? [baseline.run.id] : []),
    ...compared.filter((id) => id !== baseline?.run.id),
  ];
  return ids
    .filter((id) => id !== currentId && byId.has(id))
    .map((id) => byId.get(id)!)
    .slice(0, COMPARE_LIMIT - 1);
}

/** Toggles a run in the comparison, refusing a run beyond the plot's series limit. */
export function toggleCompared(
  compared: string[],
  id: string,
  limit = COMPARE_LIMIT - 1,
): string[] {
  if (compared.includes(id)) return compared.filter((item) => item !== id);
  return compared.length >= limit ? compared : [...compared, id];
}

export type RunStore = {
  load(key: string): Promise<SavedRun[]>;
  save(key: string, runs: SavedRun[]): Promise<void>;
};

export function memoryStore(): RunStore {
  const stored = new Map<string, SavedRun[]>();
  return {
    load: async (key) => stored.get(key) ?? [],
    save: async (key, runs) => {
      stored.set(key, runs);
    },
  };
}

const isSavedRun = (value: unknown): value is SavedRun =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SavedRun).savedAt === "number" &&
  (value as SavedRun).run?.schema === RUN_SCHEMA;

function request<T>(open: () => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const pending = open();
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

/**
 * An IndexedDB store: one record per experiment holding its runs. Runs are stored by
 * structured clone, so NaN samples survive. Any failure falls back to `fallback`.
 */
export function indexedDbStore(
  factory: IDBFactory,
  fallback: RunStore = memoryStore(),
  name = DB_NAME,
): RunStore {
  let database: Promise<IDBDatabase> | undefined;
  const open = () =>
    (database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const pending = factory.open(name, 1);
      pending.onupgradeneeded = () =>
        pending.result.createObjectStore(STORE_NAME);
      pending.onsuccess = () => resolve(pending.result);
      pending.onerror = () => reject(pending.error);
    }));
  return {
    async load(key) {
      try {
        const db = await open();
        const value: unknown = await request(() =>
          db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key),
        );
        return Array.isArray(value) ? value.filter(isSavedRun) : [];
      } catch {
        return fallback.load(key);
      }
    },
    async save(key, runs) {
      try {
        const db = await open();
        await request(() =>
          db
            .transaction(STORE_NAME, "readwrite")
            .objectStore(STORE_NAME)
            .put(runs, key),
        );
      } catch {
        await fallback.save(key, runs);
      }
    },
  };
}

let shared: RunStore | undefined;

/** The browser's IndexedDB store, or a memory store where IndexedDB is missing. */
export function defaultRunStore(): RunStore {
  if (shared) return shared;
  let factory: IDBFactory | undefined;
  try {
    factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
  } catch {
    factory = undefined;
  }
  shared = factory ? indexedDbStore(factory) : memoryStore();
  return shared;
}

export type HistoryState = {
  key: string;
  runs: SavedRun[];
  compared: string[];
  loaded: boolean;
  /** Changed since the last load, so it is saved. */
  dirty: boolean;
};

export const freshHistory = (key: string): HistoryState => ({
  key,
  runs: [],
  compared: [],
  loaded: false,
  dirty: false,
});

const forKey = (previous: HistoryState, key: string) =>
  previous.key === key ? previous : freshHistory(key);

/**
 * The state once a key's stored runs arrive. Runs kept before the load finished are merged
 * in and leave the history dirty, so they are saved with the stored ones.
 */
export function loadedHistory(
  previous: HistoryState,
  key: string,
  stored: SavedRun[],
): HistoryState {
  const base = forKey(previous, key);
  return {
    ...base,
    runs: mergeRuns(stored, base.runs),
    loaded: true,
    dirty: base.runs.length > 0,
  };
}

/** Applies a change to the history of `key`, starting afresh if another key was shown. */
export function changedHistory(
  previous: HistoryState,
  key: string,
  change: (base: HistoryState) => Partial<HistoryState>,
): HistoryState {
  const base = forKey(previous, key);
  return { ...base, ...change(base), dirty: true };
}

/** Keeps runs at one time; the first run given ends up newest. */
export function keptRuns(
  existing: SavedRun[],
  runs: MotionRun[],
  savedAt: number,
): SavedRun[] {
  let next = existing;
  for (const run of [...runs].reverse()) next = addRun(next, run, savedAt);
  return next;
}

export type RunHistory = {
  runs: SavedRun[];
  compared: string[];
  baseline?: SavedRun;
  loaded: boolean;
  /** Keeps runs, under another experiment's key when one is given. */
  add: (runs: MotionRun[], key?: string) => void;
  remove: (id: string) => void;
  pin: (id: string) => void;
  toggle: (id: string) => void;
};

/** The history of one experiment, loaded from and saved to `store`. */
export function useRunHistory(
  key: string,
  store: RunStore = defaultRunStore(),
): RunHistory {
  const [state, setState] = useState<HistoryState>(() => freshHistory(key));
  const current = state.key === key ? state : freshHistory(key);

  useEffect(() => {
    let cancelled = false;
    store.load(key).then(
      (stored) => {
        if (!cancelled)
          setState((previous) => loadedHistory(previous, key, stored));
      },
      () => {
        if (!cancelled)
          setState((previous) => loadedHistory(previous, key, []));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, store]);

  useEffect(() => {
    if (state.loaded && state.dirty)
      store.save(state.key, state.runs).catch(() => {
        // The history stays in memory for the session.
      });
  }, [state, store]);

  const update = useCallback(
    (change: (base: HistoryState) => Partial<HistoryState>, target = key) =>
      setState((previous) => changedHistory(previous, target, change)),
    [key],
  );
  const add = useCallback(
    (runs: MotionRun[], target?: string) =>
      update(
        (base) => ({ runs: keptRuns(base.runs, runs, Date.now()) }),
        target,
      ),
    [update],
  );
  const remove = useCallback(
    (id: string) =>
      update((base) => ({
        runs: removeRun(base.runs, id),
        compared: base.compared.filter((item) => item !== id),
      })),
    [update],
  );
  const pin = useCallback(
    (id: string) => update((base) => ({ runs: pinRun(base.runs, id) })),
    [update],
  );
  // The comparison is a view choice and is not stored, so it leaves the history clean.
  const toggle = useCallback(
    (id: string) =>
      setState((previous) => {
        const base = forKey(previous, key);
        return { ...base, compared: toggleCompared(base.compared, id) };
      }),
    [key],
  );

  return {
    runs: current.runs,
    compared: current.compared,
    baseline: current.runs.find((entry) => entry.pinned),
    loaded: current.loaded,
    add,
    remove,
    pin,
    toggle,
  };
}
