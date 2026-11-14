import { describe, expect, it } from "vitest";
import { exampleBracket, examplePlate } from "../physics/case";
import { parseHash, parseLabQuery } from "../routes";
import { encodeShare } from "../share";
import { makeScene } from "./scene";
import { caseShareUrl, loadShared, sceneShareUrl } from "./shared";

const BASE = "https://site.test/";

function locate(url: string) {
  const { path, query } = parseHash(new URL(url).hash);
  expect(path).toBe("/lab");
  return parseLabQuery(query);
}

describe("share links", () => {
  it("reopens a Motion scene", async () => {
    const scene = makeScene("pulley");
    const location = locate(await sceneShareUrl(scene, BASE));
    expect(location.study).toBe("motion");
    expect((await loadShared(location)).scene).toEqual(scene);
  });

  it("reopens a Stress case", async () => {
    const c = exampleBracket();
    const location = locate(await caseShareUrl(c, BASE));
    expect(location.study).toBe("stress");
    expect((await loadShared(location)).case).toEqual(c);
  });

  it("opens nothing extra without a shared value", async () => {
    expect(await loadShared({ study: "motion" })).toEqual({});
  });

  it("reports links that decode to an invalid set-up", async () => {
    const bad = { ...examplePlate(), thickness: -1 };
    const result = await loadShared({
      study: "stress",
      case: await encodeShare(bad),
    });
    expect(result.case).toBeUndefined();
    expect(result.error).toMatch(/could not be opened: thickness/);
    const scene = await loadShared({
      study: "motion",
      scene: await encodeShare({ version: "nope" }),
    });
    expect(scene.error).toMatch(/could not be opened/);
    expect((await loadShared({ study: "stress", case: "AAAA" })).error).toMatch(
      /could not be opened/,
    );
  });

  /** Calls a hosted tool; the Worker is plain JavaScript outside this project. */
  async function hosted(name: string, args: unknown) {
    const path = new URL("../../../mcp/sites/worker.mjs", import.meta.url).href;
    const worker = (await import(/* @vite-ignore */ path)) as {
      default: { fetch: (request: Request, env: unknown) => Promise<Response> };
    };
    const reply = await worker.default.fetch(
      new Request("https://physix.test/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "oai-authenticated-user-id": "test-user",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
      {},
    );
    return (await reply.json()).result.structuredContent;
  }

  it("opens the scene a hosted build_scene result links to", async () => {
    const built = (await hosted("build_scene", {
      objects: [{ kind: "spring", stiffness: 200, offset: 0.3 }],
    })) as { scene: unknown; share_url: string };
    const opened = await loadShared(locate(built.share_url));
    expect(opened.error).toBeUndefined();
    expect(opened.scene).toEqual(built.scene);
  });

  it("opens the case a hosted compare_stress result links to", async () => {
    const { results } = await hosted("compare_stress", {
      family: "plate",
      cases: [{ radius_m: 0.016, load_multiplier: 2 }],
    });
    const [result] = results as { case: unknown; share_url: string }[];
    const opened = await loadShared(locate(result.share_url));
    expect(opened.error).toBeUndefined();
    expect(opened.case).toEqual(result.case);
    expect(opened.case?.geometry.holes[0].radius).toBe(0.016);
  });
});
