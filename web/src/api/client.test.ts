import { afterEach, describe, expect, it, vi } from "vitest";
import { examplePlate } from "../physics/case";
import {
  api,
  ApiError,
  decodeFloat32,
  decodeInt32,
  fieldComponent,
  type FieldPayload,
} from "./client";

function b64(arr: Float32Array | Int32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function respond(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("payload decoding", () => {
  it("round-trips little-endian float32 and int32", () => {
    const f = new Float32Array([1.5, -2, Number.NaN, 3e8]);
    const back = decodeFloat32(b64(f));
    expect(back[0]).toBe(1.5);
    expect(back[1]).toBe(-2);
    expect(back[2]).toBeNaN();
    expect(back[3]).toBeCloseTo(3e8, -2);
    expect(Array.from(decodeInt32(b64(new Int32Array([0, 7, -1]))))).toEqual([
      0, 7, -1,
    ]);
  });

  it("slices one component from a field payload", () => {
    const data = new Float32Array(2 * 2 * 3).map((_, k) => k);
    const field: FieldPayload = {
      frame: {
        schema: "physix.raster/1",
        rows: 2,
        cols: 3,
        dx: 1,
        x0: 0,
        y0: 0,
        row_order: "top_to_bottom",
      },
      components: ["sxx", "von_mises"],
      units: "Pa",
      encoding: "base64-float32-le",
      shape: [2, 2, 3],
      data: b64(data),
    };
    expect(Array.from(fieldComponent(field, "von_mises"))).toEqual([
      6, 7, 8, 9, 10, 11,
    ]);
    expect(() => fieldComponent(field, "tau")).toThrow();
  });
});

describe("request errors", () => {
  it("posts the case and returns the parsed body", async () => {
    const fetchMock = respond(200, {
      schema: "physix.prediction/1",
      source: "fem",
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await api.predict(examplePlate(), { force_fem: true });
    expect(out.source).toBe("fem");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/predict");
    expect(JSON.parse(init.body as string)).toMatchObject({
      force_fem: true,
      case: { family: "plate" },
    });
  });

  it("maps validation errors to ApiError with the field path", async () => {
    vi.stubGlobal(
      "fetch",
      respond(422, {
        error: "invalid_case",
        message: "radius must be positive",
        field: "geometry.holes[0].radius",
      }),
    );
    const err = await api.verify(examplePlate()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "invalid_case",
      status: 422,
      field: "geometry.holes[0].radius",
    });
  });

  it("reports an unreachable API as offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(api.health()).rejects.toMatchObject({
      code: "offline",
      status: 0,
    });
  });

  it("reports a non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502 })),
    );
    await expect(api.health()).rejects.toMatchObject({
      code: "bad_response",
      status: 502,
    });
  });
});
