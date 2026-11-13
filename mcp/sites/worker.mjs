import reference from "./reference-stress.json" with { type: "json" };
import {
  buildScene,
  motionDomain,
  SceneRequestError,
  sceneRequestSchema,
} from "../../web/src/lab/buildScene.ts";
import {
  parseRunRequest,
  RunRequestError,
  runRequestSchema,
  simulateScene,
} from "../../web/src/lab/motion/hostedRun.ts";
import {
  CHART_VIEW_HTML,
  CHART_VIEW_MIME,
  CHART_VIEW_URI,
} from "./chartView.mjs";

const VERSION = "2026-07-28";
const PREVIOUS_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const MAX_REQUEST_BYTES = 16_384;
const MAX_SHARE_CHARS = 8192;
const NO_STORE = { "Cache-Control": "private, no-store" };
const identityHeader = "oai-authenticated-user-id";
const personalPlugins = "https://chatgpt.com/plugins?view=personal";
const domain = Object.entries(reference.families).map(([family, entry]) => ({
  family,
  example: entry.example,
  hole_radii_m: entry.results.map((row) => row.radius_m),
}));

/** Tool `_meta` that shows a result in the chat chart view (MCP Apps and its ChatGPT alias). */
const chartView = (invoking, invoked) => ({
  ui: { resourceUri: CHART_VIEW_URI },
  "openai/outputTemplate": CHART_VIEW_URI,
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
});

const tools = [
  {
    name: "describe_domain",
    title: "List supported experiments",
    description:
      "Return what Physix supports. Stress: the exact hosted plate and L-bracket geometries, supported hole radii and load directions for 2D static plane-stress experiments. Motion: the scene conventions, templates, part kinds with their fields, units, limits and defaults, and materials for build_scene. Call this before comparing stress or building a scene.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "compare_stress",
    title: "Compare stress experiments",
    description:
      "Compare up to six hole radii and load magnitudes on a supported thin plate or L-bracket. Returns peak and hotspot von Mises stress in Pa and hotspot location in metres, and shows them as a bar chart in the chat. Uses scikit-fem reference runs with exact linear scaling for a positive load multiplier. Fixed specimen, hole centre, material, support and load direction. Use describe_domain to get available radii. Each result includes a share_url that opens the identical case in the Physix lab; give it to the user unchanged. This tool returns stress summaries and does not create a new mesh or simulate motion.",
    inputSchema: {
      type: "object",
      required: ["family", "cases"],
      additionalProperties: false,
      properties: {
        family: { type: "string", enum: domain.map(({ family }) => family) },
        cases: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            required: ["radius_m"],
            additionalProperties: false,
            properties: {
              radius_m: {
                type: "number",
                description:
                  "Supported hole radius in metres. Convert mm to m before calling.",
              },
              load_multiplier: {
                type: "number",
                minimum: 0.01,
                maximum: 4,
                description:
                  "Positive scale factor on the example load, default 1.",
              },
            },
          },
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: chartView("Comparing stress…", "Stress compared"),
  },
  {
    name: "build_scene",
    title: "Build a motion experiment",
    description:
      "Build a rigid-body motion experiment (blocks, balls and cylinders on ramps or the floor, Atwood pulleys, pendulums, springs, launches, applied forces, air drag) in the Physix lab and return a share_url that opens it. Give only the values the problem states; every other field takes the lab default, and the result lists which defaults were used. The scene is validated, not simulated: use simulate_scene for numbers and graphs. Give the share_url to the user unchanged.",
    inputSchema: sceneRequestSchema(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "simulate_scene",
    title: "Simulate a motion experiment",
    description:
      "Simulate a motion experiment with the Physix lab's own rigid-body engine (Rapier) on the server and show its key graphs in the chat. Takes a scene request (the same fields as build_scene) or a scene that build_scene returned, an optional stop event and time limit (0.5 to 60 s). Returns the events, the closed-form theory values with the simulated values and their difference, the start, end, min and max of each plotted quantity in SI units, and a share_url that opens the scene in the Physix lab, which recomputes the run in the browser. The graphs appear in the chat's chart view. If the chart view cannot open, call again with series: true and plot only the returned series values; never plot curves the result does not contain. Quote numbers only from this result; give the share_url to the user unchanged.",
    inputSchema: runRequestSchema(sceneRequestSchema()),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: chartView("Simulating the experiment…", "Experiment simulated"),
  },
];

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed) {
  return (
    object(value) && Object.keys(value).every((key) => allowed.includes(key))
  );
}

/** `meta` reaches only the chart view; the model reads `content` and `structuredContent`. */
function toolResult(data, meta) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    ...(data.error ? { isError: true } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

/**
 * Share links (`physix.share/1`, docs/CONTRACTS.md): the case as raw-deflate JSON in
 * unpadded base64url, in the URL fragment of the lab, so the link opens the identical case
 * in the browser without server storage. `web/src/share.ts` reads the same encoding.
 */
async function encodeShare(value) {
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function shareUrl(origin, study, value) {
  const payload = await encodeShare(value);
  if (payload.length > MAX_SHARE_CHARS) return null;
  const key = study === "motion" ? "scene" : "case";
  const query = new URLSearchParams({ study, [key]: payload });
  return `${origin}/#/lab?${query}`;
}

async function buildSceneResult(args, origin) {
  let built;
  try {
    built = buildScene(args);
  } catch (error) {
    if (!(error instanceof SceneRequestError)) throw error;
    return {
      error: "invalid_scene",
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    };
  }
  const url = await shareUrl(origin, "motion", built.scene);
  if (!url)
    return {
      error: "invalid_scene",
      message: "The scene is too large for a share link; use fewer parts.",
    };
  return {
    schema: "physix.hosted-scene/1",
    source: "scene_builder",
    scene: built.scene,
    defaults: built.defaults,
    share_url: url,
    simulated: false,
    note: "The scene is validated but not simulated. The Physix lab simulates it in the browser and plots its graphs when the share_url opens.",
  };
}

/**
 * Runs a `physix.run-request/1` with the lab's engine. The graphs go to the chart view in
 * the result `_meta`; the model gets the events, theory checks and column summaries.
 */
async function simulateSceneResult(args, origin) {
  let parsed;
  try {
    parsed = parseRunRequest(args);
  } catch (error) {
    if (!(error instanceof RunRequestError)) throw error;
    return {
      data: {
        error: "invalid_run",
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
      },
    };
  }
  const url = await shareUrl(origin, "motion", parsed.scene);
  if (!url)
    return {
      data: {
        error: "invalid_run",
        message: "The scene is too large for a share link; use fewer parts.",
      },
    };
  let run;
  try {
    run = await simulateScene(parsed);
  } catch (error) {
    return {
      data: {
        error: "engine_unavailable",
        message: `The motion engine could not run this scene on the server (${error instanceof Error ? error.message : String(error)}). The share_url opens it in the Physix lab, which runs it in the browser.`,
        share_url: url,
      },
    };
  }
  return {
    data: {
      ...run.result,
      share_url: url,
      note: "Simulated on the server with the Physix lab's engine; the lab recomputes the run in the browser when the share_url opens. Theory values hold only under their listed assumptions.",
    },
    meta: { graphs: run.graphs },
  };
}

/** The chart view as an MCP Apps resource. Links open the lab on this Worker's origin. */
function chartResource(origin) {
  return {
    uri: CHART_VIEW_URI,
    mimeType: CHART_VIEW_MIME,
    text: CHART_VIEW_HTML,
    _meta: {
      ui: {
        prefersBorder: true,
        csp: { connectDomains: [], resourceDomains: [] },
      },
      "openai/widgetDescription":
        "Shows the graphs and theory checks of a Physix motion run, or a bar chart of a stress comparison, with a button that opens the Physix lab.",
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": {
        connect_domains: [],
        resource_domains: [],
        redirect_domains: [origin],
      },
    },
  };
}

async function compareStress(args, origin) {
  if (
    !onlyKeys(args, ["family", "cases"]) ||
    typeof args.family !== "string" ||
    !Object.hasOwn(reference.families, args.family) ||
    !Array.isArray(args.cases) ||
    args.cases.length < 1 ||
    args.cases.length > 6
  ) {
    return {
      error: "invalid_request",
      message: "Choose plate or bracket and send between one and six cases.",
    };
  }
  const family = reference.families[args.family];
  const results = [];
  const start = performance.now();
  for (const [index, item] of args.cases.entries()) {
    if (
      !onlyKeys(item, ["radius_m", "load_multiplier"]) ||
      !Number.isFinite(item.radius_m)
    ) {
      return {
        error: "invalid_request",
        message:
          "Each case must contain a numeric radius_m and may contain load_multiplier.",
        field: `cases[${index}]`,
      };
    }
    const row = family.results.find(
      ({ radius_m }) => radius_m === item.radius_m,
    );
    if (!row) {
      return {
        error: "unsupported_case",
        message: `Choose a supported radius in metres: ${family.results.map((row) => row.radius_m).join(", ")}.`,
        field: `cases[${index}].radius_m`,
      };
    }
    const scale = item.load_multiplier === undefined ? 1 : item.load_multiplier;
    if (!Number.isFinite(scale) || scale < 0.01 || scale > 4) {
      return {
        error: "invalid_request",
        message: "Load multiplier must be between 0.01 and 4.",
        field: `cases[${index}].load_multiplier`,
      };
    }
    const caseData = structuredClone(family.example);
    caseData.geometry.holes[0].radius = row.radius_m;
    caseData.load.x *= scale;
    caseData.load.y *= scale;
    results.push({
      radius_m: row.radius_m,
      load_multiplier: scale,
      case: caseData,
      share_url: await shareUrl(origin, "stress", caseData),
      source: scale === 1 ? "fem_reference" : "fem_reference_scaled",
      reference_case_id: row.reference_case_id,
      mesh: row.mesh,
      summary: {
        max_von_mises: row.summary.max_von_mises * scale,
        hotspot: {
          ...row.summary.hotspot,
          von_mises: row.summary.hotspot.von_mises * scale,
        },
        max_displacement: row.summary.max_displacement * scale,
        equilibrium_residual: row.summary.equilibrium_residual,
      },
    });
  }
  return {
    schema: "physix.hosted-stress/1",
    reference_schema: reference.schema,
    family: args.family,
    units: { stress: "Pa", length: "m", traction: "Pa", force: "N" },
    solver: reference.solver,
    hotspot_rule:
      "Maximum von Mises stress outside the support exclusion band.",
    uncertainty:
      "Mesh-dependent reference values. Linear scaling adds no interpolation. Check that loads remain in the elastic range for the material.",
    timing: {
      total_ms: performance.now() - start,
      boundary:
        "Hosted reference lookup and linear scaling, excluding transport and original FEM solve.",
    },
    results,
  };
}

function jsonRpc(id, payload, status = 200) {
  return Response.json(
    { jsonrpc: "2.0", id, ...payload },
    { status, headers: NO_STORE },
  );
}

function rpcError(id, code, message, status) {
  return jsonRpc(id, { error: { code, message } }, status);
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RangeError("Request body is too large.");
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function handleMcp(request) {
  if (request.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", ...NO_STORE },
    });
  const origin = request.headers.get("Origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    origin !== "https://chatgpt.com"
  )
    return rpcError(null, -32000, "Origin is not allowed.", 403);
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  )
    return rpcError(null, -32600, "Expected application/json.", 415);

  let input;
  try {
    input = await readJson(request);
  } catch (error) {
    if (error instanceof RangeError)
      return rpcError(null, -32600, error.message, 413);
    return rpcError(null, -32700, "Invalid JSON.", 400);
  }
  if (
    !object(input) ||
    input.jsonrpc !== "2.0" ||
    typeof input.method !== "string" ||
    (Object.hasOwn(input, "id") &&
      typeof input.id !== "string" &&
      !Number.isFinite(input.id))
  ) {
    return rpcError(null, -32600, "Invalid JSON-RPC request.", 400);
  }
  const { id, method, params } = input;
  if (id === undefined)
    return new Response(null, { status: 202, headers: NO_STORE });

  if (method === "server/discover")
    return jsonRpc(id, {
      result: {
        supportedVersions: [VERSION],
        capabilities: { tools: {}, resources: {} },
      },
    });
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    return jsonRpc(id, {
      result: {
        protocolVersion: PREVIOUS_VERSIONS.includes(requested)
          ? requested
          : VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "physix", title: "Physix", version: "1.0.0" },
        instructions:
          "Call describe_domain first. compare_stress returns cached reference stress results. build_scene builds a motion experiment; simulate_scene also runs it with the lab's engine and shows its graphs in the chat. Each returns a share_url that opens the identical case or scene in the Physix lab; give it to the user unchanged.",
      },
    });
  }
  if (method === "ping") return jsonRpc(id, { result: {} });
  if (method === "tools/list") return jsonRpc(id, { result: { tools } });
  if (method === "resources/list")
    return jsonRpc(id, {
      result: {
        resources: [
          {
            uri: CHART_VIEW_URI,
            name: "chart-view",
            title: "Physix chart view",
            mimeType: CHART_VIEW_MIME,
          },
        ],
      },
    });
  if (method === "resources/templates/list")
    return jsonRpc(id, { result: { resourceTemplates: [] } });
  if (method === "resources/read") {
    if (params?.uri !== CHART_VIEW_URI)
      return rpcError(id, -32002, "Resource not found.");
    return jsonRpc(id, {
      result: { contents: [chartResource(new URL(request.url).origin)] },
    });
  }
  if (method !== "tools/call") return rpcError(id, -32601, "Method not found.");
  if (!request.headers.get(identityHeader))
    return rpcError(id, -32001, "Sign in and connect Physix in ChatGPT.", 401);
  if (!object(params) || typeof params.name !== "string")
    return rpcError(id, -32602, "Supply a tool name and its arguments.");

  const args = params.arguments === undefined ? {} : params.arguments;
  let result;
  let meta;
  if (params.name === "describe_domain" && onlyKeys(args, [])) {
    result = {
      schema: reference.schema,
      analysis:
        "2D static plane stress, small-strain isotropic linear elasticity",
      families: domain,
      load_multiplier: { min: 0.01, max: 4, default: 1 },
      solver: reference.solver,
      motion: motionDomain(),
    };
  } else if (params.name === "describe_domain") {
    result = {
      error: "invalid_request",
      message: "describe_domain takes no arguments.",
    };
  } else if (params.name === "build_scene") {
    result = await buildSceneResult(args, new URL(request.url).origin);
  } else if (params.name === "simulate_scene") {
    ({ data: result, meta } = await simulateSceneResult(
      args,
      new URL(request.url).origin,
    ));
  } else if (params.name === "compare_stress") {
    result = await compareStress(args, new URL(request.url).origin);
  } else {
    return rpcError(id, -32602, "Unknown Physix tool.");
  }
  return jsonRpc(id, { result: toolResult(result, meta) });
}

function pluginDetailsUrl(value) {
  return typeof value === "string" &&
    /^https:\/\/chatgpt\.com\/plugins(?:[/?#]|$)/.test(value)
    ? value
    : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return handleMcp(request);
    if (url.pathname === "/connect/start") {
      if (request.method !== "GET")
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET", ...NO_STORE },
        });
      const destination = request.headers.get(identityHeader)
        ? (pluginDetailsUrl(env.PHYSIX_CHATGPT_PLUGIN_URL) ?? personalPlugins)
        : "/signin-with-chatgpt?return_to=%2Fconnect";
      return new Response(null, {
        status: 302,
        headers: { Location: destination, ...NO_STORE },
      });
    }
    if (url.pathname === "/connect" && request.method === "GET")
      return new Response(null, {
        status: 302,
        headers: { Location: "/#/connect", ...NO_STORE },
      });
    if (url.pathname === "/api/connection") {
      if (request.method !== "GET")
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET", ...NO_STORE },
        });
      const signedIn = Boolean(request.headers.get(identityHeader));
      return Response.json(
        {
          signedIn,
          pluginUrl: signedIn
            ? pluginDetailsUrl(env.PHYSIX_CHATGPT_PLUGIN_URL)
            : null,
        },
        { headers: NO_STORE },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
