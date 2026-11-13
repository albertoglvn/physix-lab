import { describe, expect, it } from "vitest";
import { buildScene, sceneRequestSchema } from "../buildScene";
import { makeScene } from "../scene";
import {
  GRAPH_POINTS,
  HOSTED_RUN_SCHEMA,
  MAX_GRAPHS,
  MAX_REFERENCES,
  parseRunRequest,
  RunRequestError,
  runRequestSchema,
  sampleIndices,
  simulateScene,
} from "./hostedRun";
import { CONTACT_MODEL, referencesFor } from "./theory";

const fieldOf = (input: unknown) => {
  try {
    parseRunRequest(input);
  } catch (error) {
    if (error instanceof RunRequestError) return error.field;
    throw error;
  }
  return "accepted";
};

const crowd = Array.from({ length: 32 }, (_, i) => ({
  kind: "ball",
  x: -6 + (i % 8) * 1.5,
  z: -3 + Math.floor(i / 8) * 1.5,
  y: 1 + (i % 3),
  radius: 0.2,
}));

describe("hosted run requests", () => {
  it("builds the scene from a request and takes the lab's default protocol", () => {
    const parsed = parseRunRequest({ request: { template: "incline" } });
    expect(parsed.scene).toEqual(buildScene({ template: "incline" }).scene);
    expect(parsed.protocol.stop).toBe("leaves_ramp");
    expect(parsed.points).toBe(GRAPH_POINTS.series);
    expect(parsed.series).toBe(true);
  });

  it("accepts a built scene with a chosen stop, time limit and sample count", () => {
    const scene = makeScene("pendulum");
    const parsed = parseRunRequest({
      scene,
      stop: "time",
      max_time_s: 2,
      points: 30,
    });
    expect(parsed.scene).toEqual(scene);
    expect(parsed.defaults).toBeUndefined();
    expect(parsed.protocol).toMatchObject({ stop: "time", maxTime: 2 });
    expect(parsed.points).toBe(30);
  });

  it("names the field of each invalid request", () => {
    for (const [input, field] of [
      [null, "arguments"],
      [[], "arguments"],
      [{}, "request"],
      [{ request: {}, scene: {} }, "request"],
      [{ request: {}, colour: 1 }, "colour"],
      [
        { request: { objects: [{ kind: "ball", mass: 500 }] } },
        "request.objects[0].mass",
      ],
      [{ request: { template: "rocket" } }, "request.template"],
      [{ scene: { version: "nope" } }, "scene"],
      [{ request: { template: "pendulum" }, stop: "bounce" }, "stop"],
      [{ request: {}, stop: 3 }, "stop"],
      [{ request: {}, max_time_s: 0.1 }, "max_time_s"],
      [{ request: {}, max_time_s: 600 }, "max_time_s"],
      [{ request: {}, max_time_s: "5" }, "max_time_s"],
      [{ request: {}, points: 19 }, "points"],
      [{ request: {}, points: 401 }, "points"],
      [{ request: {}, points: 40.5 }, "points"],
      [{ request: {}, series: "yes" }, "series"],
    ] as [unknown, string][])
      expect(fieldOf(input), JSON.stringify(input)).toBe(field);
  });

  it("publishes a closed schema around the scene request", () => {
    const schema = runRequestSchema(sceneRequestSchema());
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual([
      "request",
      "scene",
      "stop",
      "max_time_s",
      "points",
      "series",
    ]);
    expect(schema.properties.stop.enum).toContain("time");
    expect(schema.properties.points).toMatchObject({
      minimum: GRAPH_POINTS.min,
      maximum: GRAPH_POINTS.max,
    });
  });
});

describe("downsampling", () => {
  it("keeps every sample when there are few enough", () => {
    expect(sampleIndices(4, 10)).toEqual([0, 1, 2, 3]);
  });

  it("spreads samples evenly and keeps the first and last", () => {
    const indices = sampleIndices(3601, 120);
    expect(indices).toHaveLength(120);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(3600);
    for (let i = 1; i < indices.length; i += 1)
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  });
});

describe("hosted simulation", () => {
  it("condenses an incline run into events, theory checks, summaries and graphs", async () => {
    const { result, graphs } = await simulateScene(
      parseRunRequest({ request: { template: "incline" }, points: 50 }),
    );
    expect(result.schema).toBe(HOSTED_RUN_SCHEMA);
    expect(result.source).toBe("rapier");
    expect(result.run.stop.reason).toBe("event");
    expect(result.events.map((event) => event.type)).toContain("leaves_ramp");
    expect(result.contact_model).toBe(CONTACT_MODEL);
    expect(result.references_omitted).toBe(0);
    for (const reference of result.references) {
      expect(reference.within).toBe(true);
      expect(reference.assumptions).not.toContain(CONTACT_MODEL);
    }

    expect(result.graphs.map((graph) => graph.id)).toEqual(
      graphs.map((graph) => graph.id),
    );
    for (const graph of graphs) {
      expect(graph.t.length).toBeLessThanOrEqual(50);
      for (const series of graph.series) {
        expect(series.values).toHaveLength(graph.t.length);
        // Flat columns are left out of the graphs.
        expect(series.values.some((value) => Math.abs(value) > 1e-9)).toBe(
          true,
        );
      }
    }
    // The block slides along x, so its velocity carries the closed-form overlay.
    const velocity = graphs.find((graph) => graph.id === "block-1.velocity");
    expect(velocity?.unit).toBe("m/s");
    expect(velocity?.series.some((series) => series.theory)).toBe(true);
    const energy = graphs.find((graph) => graph.id === "system.energy");
    expect(energy?.title).toBe("Energy");

    const speed = result.summary.find((row) => row.key === "block-1.speed");
    expect(speed?.start).toBe(0);
    expect(speed?.max).toBeGreaterThan(0);
  });

  it("caps graphs and theory checks for a crowded scene", async () => {
    const parsed = parseRunRequest({
      request: { objects: crowd },
      stop: "time",
      max_time_s: 0.5,
    });
    const total = referencesFor(parsed.scene).length;
    expect(total).toBeGreaterThan(MAX_REFERENCES);
    const { result, graphs } = await simulateScene(parsed);
    expect(result.references).toHaveLength(MAX_REFERENCES);
    expect(result.references_omitted).toBe(total - MAX_REFERENCES);
    expect(graphs.length).toBeLessThanOrEqual(MAX_GRAPHS);
    expect(result.run.stop).toEqual({ reason: "time", t: 0.5 });
  });
});

describe("series for the model", () => {
  it("returns the plotted values by default", async () => {
    const { result, graphs } = await simulateScene(
      parseRunRequest({ request: { template: "incline" } }),
    );
    expect(result.series).toEqual(graphs);
    for (const graph of graphs)
      expect(graph.t.length).toBeLessThanOrEqual(GRAPH_POINTS.series);
    const chosen = parseRunRequest({
      request: { template: "incline" },
      points: 25,
    });
    expect(chosen.points).toBe(25);
  });

  it("leaves the plotted values out with more points when series is false", async () => {
    const parsed = parseRunRequest({
      request: { template: "incline" },
      series: false,
    });
    expect(parsed.points).toBe(GRAPH_POINTS.view);
    const { result, graphs } = await simulateScene(parsed);
    expect(result.series).toBeUndefined();
    expect(graphs.length).toBeGreaterThan(0);
  });
});
