import { beforeAll, describe, expect, it } from "vitest";
import { defaultProtocol } from "../motion/probes";
import { runProtocol, type MotionRun } from "../motion/run";
import { makeObject, makeScene, type LabScene } from "../scene";
import {
  addRun,
  changedHistory,
  COMPARE_LIMIT,
  freshHistory,
  HISTORY_LIMIT,
  historyKey,
  indexedDbStore,
  inputDifferences,
  keptRuns,
  loadedHistory,
  memoryStore,
  mergeRuns,
  overlaidRuns,
  pinRun,
  removeRun,
  runLabel,
  toggleCompared,
  type SavedRun,
} from "./runs";

const scene = makeScene("incline");
let base: MotionRun;

beforeAll(async () => {
  base = await runProtocol(scene, defaultProtocol(scene));
});

/** A copy of the base run standing in for a run with another identity. */
const variant = (id: string, change: (scene: LabScene) => void = () => {}) => {
  const copy = structuredClone(base);
  copy.id = id;
  change(copy.inputs.scene);
  return copy;
};

const saved = (id: string, savedAt: number, pinned = false): SavedRun => ({
  run: variant(id),
  savedAt,
  pinned,
});

describe("run history", () => {
  it("keys the history by experiment name", () => {
    expect(historyKey(scene)).toBe(`motion:${scene.name}`);
  });

  it("adds runs newest first and replaces an earlier copy", () => {
    let runs = addRun([], variant("a"), 1);
    runs = addRun(runs, variant("b"), 2);
    runs = pinRun(runs, "a");
    runs = addRun(runs, variant("a"), 3);
    expect(runs.map((entry) => entry.run.id)).toEqual(["a", "b"]);
    expect(runs[0]).toMatchObject({ savedAt: 3, pinned: true });
  });

  it("trims the oldest unpinned runs and never the baseline", () => {
    let runs: SavedRun[] = [];
    runs = addRun(runs, variant("first"), 0);
    runs = pinRun(runs, "first");
    for (let index = 1; index <= HISTORY_LIMIT + 4; index++)
      runs = addRun(runs, variant(`run-${index}`), index);
    expect(runs).toHaveLength(HISTORY_LIMIT);
    expect(runs.at(-1)?.run.id).toBe("first");
    expect(runs.some((entry) => entry.run.id === "run-1")).toBe(false);
    expect(runs[0].run.id).toBe(`run-${HISTORY_LIMIT + 4}`);
  });

  it("pins one baseline at a time and toggles it off", () => {
    let runs = [saved("a", 1), saved("b", 2)];
    runs = pinRun(runs, "a");
    runs = pinRun(runs, "b");
    expect(runs.filter((entry) => entry.pinned).map((e) => e.run.id)).toEqual([
      "b",
    ]);
    runs = pinRun(runs, "b");
    expect(runs.some((entry) => entry.pinned)).toBe(false);
  });

  it("merges runs kept before a load with the stored history", () => {
    const merged = mergeRuns(
      [saved("old", 1), saved("shared", 2)],
      [saved("shared", 5, true), saved("new", 4)],
    );
    expect(merged.map((entry) => entry.run.id)).toEqual([
      "shared",
      "new",
      "old",
    ]);
    expect(merged[0].pinned).toBe(true);
    expect(removeRun(merged, "new").map((entry) => entry.run.id)).toEqual([
      "shared",
      "old",
    ]);
  });

  it("overlays the baseline first and keeps one colour for the live run", () => {
    const runs = [saved("a", 1), saved("b", 2, true), saved("c", 3)];
    expect(
      overlaidRuns(runs, ["c", "a", "b"], "a").map((entry) => entry.run.id),
    ).toEqual(["b", "c"]);
    const many = Array.from({ length: 8 }, (_, index) => saved(`r${index}`, 0));
    expect(
      overlaidRuns(
        many,
        many.map((entry) => entry.run.id),
      ),
    ).toHaveLength(COMPARE_LIMIT - 1);
  });

  it("refuses to compare more runs than the palette has colours", () => {
    let compared: string[] = [];
    for (let index = 0; index < COMPARE_LIMIT + 2; index++)
      compared = toggleCompared(compared, `r${index}`);
    expect(compared).toHaveLength(COMPARE_LIMIT - 1);
    expect(toggleCompared(compared, "r0")).not.toContain("r0");
  });
});

describe("input differences", () => {
  const current = () => ({
    scene: structuredClone(scene),
    protocol: base.inputs.protocol,
    timeStep: base.inputs.timeStep,
    rate: base.inputs.rate,
  });

  it("reports nothing for the same inputs", () => {
    const differences = inputDifferences(base.inputs, current());
    expect(differences).toEqual([]);
    expect(runLabel(differences)).toBe("Same inputs");
  });

  it("names the stored run's values that differ from the scene", () => {
    const stored = variant("x", (old) => {
      old.gravity = 1.62;
      const block = old.objects.find((part) => part.id === "block-1")!;
      if (block.kind === "block") block.mass = 3;
    });
    const now = current();
    now.scene.objects.push(makeObject("ball", "ball-1", 5));
    const differences = inputDifferences(
      { ...stored.inputs, timeStep: 1 / 240, rate: 30 },
      now,
    );
    expect(differences).toEqual([
      "g 1.62",
      "block-1 mass 3",
      "without ball-1",
      "Δt 1/240 s",
      "30 Hz",
    ]);
    expect(runLabel(differences)).toBe("g 1.62, block-1 mass 3 +3");
  });

  it("names removed parts, moved parts and protocol changes", () => {
    const stored = variant("y", (old) => {
      old.objects.push(makeObject("ball", "ball-2", 5));
    });
    const now = current();
    const block = now.scene.objects.find((part) => part.id === "block-1")!;
    block.x += 1;
    const differences = inputDifferences(
      { ...stored.inputs, protocol: { stop: "time", maxTime: 2 } },
      now,
    );
    expect(differences[0]).toBe(
      `block-1 x ${Number((block.x - 1).toPrecision(4))}`,
    );
    expect(differences).toContain("with ball-2");
    expect(differences).toContain("max 2 s");
  });
});

describe("run stores", () => {
  it("keeps runs in memory by key", async () => {
    const store = memoryStore();
    expect(await store.load("motion:a")).toEqual([]);
    await store.save("motion:a", [saved("a", 1)]);
    expect((await store.load("motion:a"))[0].run.id).toBe("a");
    expect(await store.load("motion:b")).toEqual([]);
  });

  it("falls back to memory when IndexedDB refuses to open", async () => {
    const refusing = {
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    const fallback = memoryStore();
    const store = indexedDbStore(refusing, fallback);
    await store.save("motion:a", [saved("a", 1)]);
    expect((await store.load("motion:a"))[0].run.id).toBe("a");
    expect((await fallback.load("motion:a"))[0].run.id).toBe("a");
  });
});

describe("history state", () => {
  it("merges runs kept before the load and marks them for saving", () => {
    const early = changedHistory(freshHistory("motion:a"), "motion:a", () => ({
      runs: keptRuns([], [variant("new")], 5),
    }));
    expect(early).toMatchObject({ loaded: false, dirty: true });
    const loaded = loadedHistory(early, "motion:a", [saved("old", 1)]);
    expect(loaded.runs.map((entry) => entry.run.id)).toEqual(["new", "old"]);
    expect(loaded).toMatchObject({ loaded: true, dirty: true });
    const quiet = loadedHistory(freshHistory("motion:a"), "motion:a", [
      saved("old", 1),
    ]);
    expect(quiet.dirty).toBe(false);
  });

  it("keeps imported runs under the experiment they came from", () => {
    const shown = { ...freshHistory("motion:a"), runs: [saved("a", 1)] };
    const imported = changedHistory(shown, "motion:b", (base) => ({
      runs: keptRuns(base.runs, [variant("first"), variant("second")], 9),
    }));
    expect(imported.key).toBe("motion:b");
    expect(imported.runs.map((entry) => entry.run.id)).toEqual([
      "first",
      "second",
    ]);
    // A late load for the old key starts that key afresh rather than mixing histories.
    expect(loadedHistory(imported, "motion:a", []).runs).toEqual([]);
  });
});

type FakeRequest = {
  result: unknown;
  onsuccess?: () => void;
  onupgradeneeded?: () => void;
};

/** Just enough of IndexedDB for the store: one database with one object store. */
function fakeIndexedDb() {
  const records = new Map<string, unknown>();
  let upgrades = 0;
  const answer = (result: unknown) => {
    const request: FakeRequest = { result: undefined };
    queueMicrotask(() => {
      request.result = result;
      request.onsuccess?.();
    });
    return request;
  };
  const database = {
    createObjectStore: () => {
      upgrades++;
    },
    transaction: () => ({
      objectStore: () => ({
        get: (key: string) => answer(structuredClone(records.get(key))),
        put: (value: unknown, key: string) => {
          records.set(key, structuredClone(value));
          return answer(key);
        },
      }),
    }),
  };
  const factory = {
    open: () => {
      const request: FakeRequest = { result: undefined };
      queueMicrotask(() => {
        request.result = database;
        if (!upgrades) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, records, upgrades: () => upgrades };
}

describe("IndexedDB store", () => {
  it("round-trips runs by structured clone, NaN samples included", async () => {
    const fake = fakeIndexedDb();
    const store = indexedDbStore(fake.factory, memoryStore());
    const entry = saved("a", 1, true);
    const key = Object.keys(entry.run.series.columns)[0];
    entry.run.series.columns[key][0] = Number.NaN;
    await store.save("motion:a", [entry]);
    const [back] = await store.load("motion:a");
    expect(back).toMatchObject({ savedAt: 1, pinned: true });
    expect(back.run.series.columns[key][0]).toBeNaN();
    expect(await store.load("motion:none")).toEqual([]);
    expect(fake.upgrades()).toBe(1);
  });

  it("drops stored entries that are not runs", async () => {
    const fake = fakeIndexedDb();
    fake.records.set("motion:a", [saved("a", 1), { savedAt: 2 }, "junk"]);
    const store = indexedDbStore(fake.factory, memoryStore());
    const runs = await store.load("motion:a");
    expect(runs.map((entry) => entry.run.id)).toEqual(["a"]);
  });
});
