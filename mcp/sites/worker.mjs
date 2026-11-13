import reference from "./reference-stress.json" with { type: "json" };

const VERSION = "2026-07-28";
const PREVIOUS_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const MAX_REQUEST_BYTES = 16_384;
const NO_STORE = { "Cache-Control": "private, no-store" };
const identityHeader = "oai-authenticated-user-id";
const personalPlugins = "https://chatgpt.com/plugins?view=personal";
const domain = Object.entries(reference.families).map(([family, entry]) => ({
  family,
  example: entry.example,
  hole_radii_m: entry.results.map((row) => row.radius_m),
}));

const tools = [
  {
    name: "describe_domain",
    title: "List supported stress experiments",
    description:
      "Return the exact hosted plate and L-bracket geometries, supported hole radii and load directions for 2D static plane-stress experiments. Use this before changing geometry.",
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
      "Compare up to six hole radii and load magnitudes on a supported thin plate or L-bracket. Returns peak and hotspot von Mises stress in Pa and hotspot location in metres. Uses scikit-fem reference runs with exact linear scaling for a positive load multiplier. Fixed specimen, hole centre, material, support and load direction. Use describe_domain to get available radii. Each result includes a share_url that opens the identical case in the Physix lab; give it to the user unchanged. This tool returns stress summaries and does not create a new mesh or simulate motion.",
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

function toolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    ...(data.error ? { isError: true } : {}),
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

async function shareUrl(origin, caseData) {
  const query = new URLSearchParams({
    study: "stress",
    case: await encodeShare(caseData),
  });
  return `${origin}/#/lab?${query}`;
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
      share_url: await shareUrl(origin, caseData),
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
      result: { supportedVersions: [VERSION], capabilities: { tools: {} } },
    });
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    return jsonRpc(id, {
      result: {
        protocolVersion: PREVIOUS_VERSIONS.includes(requested)
          ? requested
          : VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "physix", title: "Physix", version: "1.0.0" },
        instructions:
          "Call describe_domain before comparing supported stress cases. Each compared case carries a share_url that opens the identical case in the Physix lab.",
      },
    });
  }
  if (method === "ping") return jsonRpc(id, { result: {} });
  if (method === "tools/list") return jsonRpc(id, { result: { tools } });
  if (method !== "tools/call") return rpcError(id, -32601, "Method not found.");
  if (!request.headers.get(identityHeader))
    return rpcError(id, -32001, "Sign in and connect Physix in ChatGPT.", 401);
  if (!object(params) || typeof params.name !== "string")
    return rpcError(id, -32602, "Supply a tool name and its arguments.");

  const args = params.arguments === undefined ? {} : params.arguments;
  let result;
  if (params.name === "describe_domain" && onlyKeys(args, [])) {
    result = {
      schema: reference.schema,
      analysis:
        "2D static plane stress, small-strain isotropic linear elasticity",
      families: domain,
      load_multiplier: { min: 0.01, max: 4, default: 1 },
      solver: reference.solver,
    };
  } else if (params.name === "describe_domain") {
    result = {
      error: "invalid_request",
      message: "describe_domain takes no arguments.",
    };
  } else if (params.name === "compare_stress") {
    result = await compareStress(args, new URL(request.url).origin);
  } else {
    return rpcError(id, -32602, "Unknown Physix tool.");
  }
  return jsonRpc(id, { result: toolResult(result) });
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
