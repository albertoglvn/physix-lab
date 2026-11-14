import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

const env = {
  ASSETS: { fetch: () => new Response("lab") },
  PHYSIX_CHATGPT_PLUGIN_URL: "https://chatgpt.com/plugins?view=personal",
};
const site = "https://physix.example";

/** The same Worker with the chat chart view turned on. */
const viewEnv = { ...env, PHYSIX_CHART_VIEW: "on" };

function rpc(
  method,
  params,
  { signedIn = true, headers = {}, worker: workerEnv = env } = {},
) {
  return worker.fetch(
    new Request(site + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signedIn ? { "oai-authenticated-user-id": "test-user" } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    workerEnv,
  );
}

async function compare(args) {
  const reply = await rpc("tools/call", {
    name: "compare_stress",
    arguments: args,
  });
  return (await reply.json()).result;
}

test("supports current Sites discovery and legacy MCP initialization", async () => {
  const response = await rpc("server/discover", {}, { signedIn: false });
  assert.deepEqual((await response.json()).result.supportedVersions, [
    "2026-07-28",
  ]);
  const legacy = await rpc("initialize", { protocolVersion: "2025-11-25" });
  assert.equal((await legacy.json()).result.protocolVersion, "2025-11-25");
  const list = await rpc("tools/list", {}, { signedIn: false });
  assert.deepEqual(
    (await list.json()).result.tools.map(({ name }) => name),
    ["describe_domain", "compare_stress", "build_scene", "simulate_scene"],
  );
});

test("requires a platform identity to call tools", async () => {
  const reply = await rpc(
    "tools/call",
    { name: "describe_domain" },
    { signedIn: false },
  );
  assert.equal(reply.status, 401);
  const authed = await rpc("tools/call", { name: "describe_domain" });
  assert.equal(
    (await authed.json()).result.structuredContent.families.length,
    2,
  );
});

test("compares bounded cases and scales the reference under a positive load", async () => {
  const reply = await compare({
    family: "plate",
    cases: [
      { radius_m: 0.012 },
      { radius_m: 0.012, load_multiplier: 2 },
      { radius_m: 0.018 },
    ],
  });
  const result = reply.structuredContent;
  const [reference, scaled, other] = result.results;
  assert.equal(result.solver.name, "scikit-fem");
  assert.equal(reference.source, "fem_reference");
  assert.equal(scaled.source, "fem_reference_scaled");
  assert.equal(reference.reference_case_id, scaled.reference_case_id);
  assert.equal(scaled.case.load.x, 2e7);
  assert.equal(
    scaled.summary.hotspot.von_mises,
    reference.summary.hotspot.von_mises * 2,
  );
  assert.notEqual(other.reference_case_id, reference.reference_case_id);
});

async function decodeShare(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}

test("links each compared case to the identical case in the lab", async () => {
  const reply = await compare({
    family: "bracket",
    cases: [{ radius_m: 0.006, load_multiplier: 0.5 }],
  });
  const [result] = reply.structuredContent.results;
  const url = new URL(result.share_url);
  assert.equal(url.origin, site);
  assert.equal(url.pathname, "/");
  assert.equal(url.search, "");
  const query = new URLSearchParams(url.hash.replace(/^#\/lab\?/, ""));
  assert.equal(query.get("study"), "stress");
  assert.match(query.get("case"), /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeShare(query.get("case")), result.case);
});

async function build(args) {
  const reply = await rpc("tools/call", {
    name: "build_scene",
    arguments: args,
  });
  return (await reply.json()).result;
}

test("describes the motion domain for build_scene", async () => {
  const reply = await rpc("tools/call", { name: "describe_domain" });
  const { motion } = (await reply.json()).result.structuredContent;
  assert.equal(motion.scene_version, "physix.lab/2");
  assert.deepEqual(motion.parts.ramp.angle, {
    unit: "deg",
    min: 5,
    max: 55,
    default: 26,
    about: "incline; it rises towards −x",
  });
  assert.ok(motion.templates.incline);
  assert.ok(motion.materials.ice);
});

test("builds a motion scene and links to it in the lab", async () => {
  const reply = await build({
    name: "Block on a 30 degree incline",
    objects: [
      { kind: "ramp", angle: 30, friction: 0.25 },
      { kind: "block", mass: 5, on_ramp: { ramp: "ramp-1" } },
    ],
  });
  const result = reply.structuredContent;
  assert.equal(reply.isError, undefined);
  assert.equal(result.source, "scene_builder");
  assert.equal(result.simulated, false);
  assert.equal(result.scene.version, "physix.lab/2");
  const [ramp, block] = result.scene.objects;
  assert.equal(ramp.angle, 30);
  assert.equal(block.rotation, -30);
  assert.deepEqual(result.defaults["block-1"], ["size", "restitution"]);
  const url = new URL(result.share_url);
  assert.equal(url.origin, site);
  const query = new URLSearchParams(url.hash.replace(/^#\/lab\?/, ""));
  assert.equal(query.get("study"), "motion");
  assert.deepEqual(await decodeShare(query.get("scene")), result.scene);
});

test("reports the field of an invalid scene request", async () => {
  for (const [args, field] of [
    [{ objects: [{ kind: "ball", mass: 500 }] }, "objects[0].mass"],
    [{ objects: [{ kind: "rocket" }] }, "objects[0].kind"],
    [{ objects: [{ kind: "ramp", colour: "red" }] }, "objects[0].colour"],
    [
      { objects: [{ kind: "block", on_ramp: { ramp: "ramp-9" } }] },
      "objects[0].on_ramp.ramp",
    ],
    [{ template: "rocket" }, "template"],
    [{ gravity: "high" }, "gravity"],
  ]) {
    const result = await build(args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.equal(result.structuredContent.error, "invalid_scene");
    assert.equal(result.structuredContent.field, field);
  }
});

async function simulate(args) {
  const reply = await rpc("tools/call", {
    name: "simulate_scene",
    arguments: args,
  });
  return (await reply.json()).result;
}

test("simulates a motion scene and checks it against theory", async () => {
  const reply = await simulate({
    request: {
      name: "Block on a 30 degree incline",
      objects: [
        { kind: "ramp", angle: 30, friction: 0.25 },
        { kind: "block", mass: 5, on_ramp: { ramp: "ramp-1" } },
      ],
    },
  });
  const result = reply.structuredContent;
  assert.equal(reply.isError, undefined);
  assert.equal(result.schema, "physix.hosted-run/1");
  assert.equal(result.source, "rapier");
  assert.equal(result.run.engine.name, "rapier3d-compat");
  assert.equal(result.protocol.stop, "leaves_ramp");
  assert.equal(result.run.stop.reason, "event");
  assert.deepEqual(result.defaults["block-1"], ["size", "restitution"]);
  const a = result.references.find((r) => r.id === "block-1.incline.a");
  const g = 9.81;
  const theory = g * (Math.sin(Math.PI / 6) - 0.25 * Math.cos(Math.PI / 6));
  assert.ok(Math.abs(a.theory - theory) < 1e-4, `${a.theory} vs ${theory}`);
  assert.equal(a.within, true);
  assert.ok(Math.abs(a.measured - theory) / theory < 0.02);
  assert.ok(result.summary.some((row) => row.key === "block-1.speed"));
  assert.deepEqual(
    result.graphs.map(({ id }) => id),
    result.series.map(({ id }) => id),
  );
  // With the chart view off, the plotted values go to the model and nothing to _meta.
  assert.equal(reply._meta, undefined);
  const velocity = result.series.find((g) => g.id === "block-1.velocity");
  assert.equal(velocity.unit, "m/s");
  assert.equal(velocity.t.length, velocity.series[0].values.length);
  assert.ok(velocity.t.length <= 40);
  assert.ok(velocity.series.some((column) => column.theory));
  const query = new URLSearchParams(
    new URL(result.share_url).hash.replace(/^#\/lab\?/, ""),
  );
  assert.deepEqual(await decodeShare(query.get("scene")), result.scene);
});

test("simulates a built scene with a chosen stop and sample count", async () => {
  const built = await build({ template: "pendulum" });
  const reply = await simulate({
    scene: built.structuredContent.scene,
    stop: "time",
    max_time_s: 2,
    points: 30,
  });
  const result = reply.structuredContent;
  assert.equal(result.run.stop.reason, "time");
  assert.equal(result.run.stop.t, 2);
  assert.equal(result.run.samples, 121);
  assert.equal(result.defaults, undefined);
  assert.ok(result.series.every((g) => g.t.length === 30));
  assert.ok(result.graphs.some(({ id }) => id === "system.energy"));
});

test("reports the field of an invalid run request", async () => {
  for (const [args, field] of [
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
    [{ request: {}, max_time_s: 600 }, "max_time_s"],
    [{ request: {}, points: 5000 }, "points"],
    [{ request: {}, series: 1 }, "series"],
  ]) {
    const result = await simulate(args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.equal(result.structuredContent.error, "invalid_run");
    assert.equal(result.structuredContent.field, field, JSON.stringify(args));
    assert.equal(result._meta, undefined);
  }
});

test("leaves the chart view out unless it is turned on", async () => {
  const list = await (await rpc("tools/list", {}, { signedIn: false })).json();
  for (const tool of list.result.tools) {
    assert.equal(tool._meta?.ui, undefined, tool.name);
    assert.equal(tool._meta?.["ui/resourceUri"], undefined, tool.name);
  }
  const init = await (await rpc("initialize", {})).json();
  assert.deepEqual(init.result.capabilities, { tools: {} });
  const resources = await (await rpc("resources/list", {})).json();
  assert.deepEqual(resources.result.resources, []);
  const read = await (
    await rpc("resources/read", { uri: "ui://physix/chart-v3.html" })
  ).json();
  assert.equal(read.error.code, -32002);
});

test("serves the chart view that simulate_scene and compare_stress show when on", async () => {
  const on = { worker: viewEnv };
  const list = await (
    await rpc("tools/list", {}, { signedIn: false, ...on })
  ).json();
  const byName = Object.fromEntries(
    list.result.tools.map((tool) => [tool.name, tool]),
  );
  const uri = byName.simulate_scene._meta.ui.resourceUri;
  assert.match(uri, /^ui:\/\//);
  assert.equal(byName.simulate_scene._meta["ui/resourceUri"], uri);
  assert.equal("openai/outputTemplate" in byName.simulate_scene._meta, false);
  assert.equal(byName.compare_stress._meta.ui.resourceUri, uri);
  assert.equal(byName.build_scene._meta, undefined);

  const init = await (await rpc("initialize", {}, on)).json();
  assert.ok(init.result.capabilities.resources);
  const resources = await (
    await rpc("resources/list", {}, { signedIn: false, ...on })
  ).json();
  assert.deepEqual(
    resources.result.resources.map((resource) => resource.uri),
    [uri],
  );
  assert.equal(resources.result.resources[0]._meta.ui.domain, site);
  const read = await (
    await rpc("resources/read", { uri }, { signedIn: false, ...on })
  ).json();
  const [view] = read.result.contents;
  assert.equal(view.mimeType, "text/html;profile=mcp-app");
  assert.match(view.text, /^<!doctype html>/);
  assert.match(view.text, /ui\/notifications\/tool-result/);
  assert.doesNotMatch(view.text, /<script[^>]+src=|<link[^>]+href=/);
  assert.deepEqual(view._meta.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
  });
  // Only the MCP Apps keys: no ChatGPT-specific widget aliases.
  assert.deepEqual(Object.keys(view._meta), ["ui"]);
  assert.equal(view._meta.ui.domain, site);
  assert.equal(view._meta.ui.prefersBorder, true);
  const missing = await (
    await rpc("resources/read", { uri: "ui://physix/none.html" }, on)
  ).json();
  assert.equal(missing.error.code, -32002);
});

test("returns explicit errors for unsupported and malformed experiments", async () => {
  for (const [caseData, error] of [
    [{ radius_m: 0.013 }, "unsupported_case"],
    [{ radius_m: 0.012, load_multiplier: 0 }, "invalid_request"],
    [{ radius_m: 0.012, material: "wood" }, "invalid_request"],
    [null, "invalid_request"],
  ]) {
    const result = await compare({ family: "plate", cases: [caseData] });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error, error);
  }
});

test("bounds request input and rejects foreign origins", async () => {
  assert.equal((await rpc("ping", { value: "x".repeat(17_000) })).status, 413);
  assert.equal(
    (await rpc("ping", {}, { headers: { Origin: "https://other.example" } }))
      .status,
    403,
  );
});

test("connection status exposes only the signed-in flag and plugin link", async () => {
  const status = (headers) =>
    worker.fetch(new Request(site + "/api/connection", { headers }), env);
  const anonymous = await status({
    "oai-authenticated-user-email": "fake@example.com",
  });
  assert.deepEqual(await anonymous.json(), {
    signedIn: false,
    pluginUrl: null,
  });
  const signedIn = await status({
    "oai-authenticated-user-id": "test-user",
    "oai-authenticated-user-email": "private@example.com",
  });
  assert.equal(signedIn.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await signedIn.json(), {
    signedIn: true,
    pluginUrl: env.PHYSIX_CHATGPT_PLUGIN_URL,
  });
  assert.equal(
    await (await worker.fetch(new Request(site), env)).text(),
    "lab",
  );
});

test("connection links start sign-in and send signed-in users to the plugin", async () => {
  const start = (headers, overrides = {}) =>
    worker.fetch(new Request(site + "/connect/start", { headers }), {
      ...env,
      ...overrides,
    });

  const anonymous = await start({});
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("Cache-Control"), "private, no-store");
  assert.equal(
    anonymous.headers.get("Location"),
    "/signin-with-chatgpt?return_to=%2Fconnect",
  );
  const returned = await worker.fetch(new Request(site + "/connect"), env);
  assert.equal(returned.headers.get("Location"), "/#/connect");

  const identity = { "oai-authenticated-user-id": "test-user" };
  const plugin = "https://chatgpt.com/plugins/physix";
  const configured = await start(identity, {
    PHYSIX_CHATGPT_PLUGIN_URL: plugin,
  });
  assert.equal(configured.headers.get("Location"), plugin);
  for (const url of [undefined, "https://chatgpt.com/plugins-lookalike"]) {
    const fallback = await start(identity, { PHYSIX_CHATGPT_PLUGIN_URL: url });
    assert.equal(
      fallback.headers.get("Location"),
      env.PHYSIX_CHATGPT_PLUGIN_URL,
    );
  }
});

/** Runs the chart view's script against a fake MCP Apps host and returns its messages. */
async function startView() {
  const { runInNewContext } = await import("node:vm");
  const { CHART_VIEW_HTML } = await import("./chartView.mjs");
  const script = CHART_VIEW_HTML.match(/<script>([\s\S]*)<\/script>/)[1];
  const sent = [];
  const listeners = {};
  const parent = {
    // postMessage clones messages, which also drops the view realm's prototypes.
    postMessage: (message) => sent.push(JSON.parse(JSON.stringify(message))),
  };
  const element = () => ({
    clientWidth: 640,
    dataset: {},
    scrollWidth: 640,
    scrollHeight: 480,
    replaceChildren() {},
    append() {},
  });
  const window = {
    parent,
    addEventListener: (type, listener) =>
      (listeners[type] ??= []).push(listener),
  };
  runInNewContext(script, {
    window,
    document: { getElementById: element, documentElement: element() },
    ResizeObserver: class {
      observe() {}
    },
  });
  const deliver = async (data, source = parent) => {
    for (const listener of listeners.message ?? []) listener({ source, data });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { sent, deliver };
}

test("the chart view completes the MCP Apps handshake and answers host requests", async () => {
  const { sent, deliver } = await startView();
  const [initialize] = sent;
  assert.equal(initialize.method, "ui/initialize");
  assert.equal(initialize.params.protocolVersion, "2026-01-26");
  assert.equal(initialize.params.appInfo.name, "physix-chart");
  assert.equal("clientInfo" in initialize.params, false);
  assert.deepEqual(initialize.params.appCapabilities, {
    availableDisplayModes: ["inline"],
  });

  // Messages from any window but the host are ignored.
  await deliver({ jsonrpc: "2.0", id: 7, method: "ping" }, {});
  assert.equal(sent.length, 1);

  await deliver({
    jsonrpc: "2.0",
    id: initialize.id,
    result: {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "host", version: "1" },
      hostCapabilities: { openLinks: {} },
      hostContext: { theme: "dark" },
    },
  });
  assert.deepEqual(
    sent.slice(1).map((message) => message.method),
    ["ui/notifications/initialized", "ui/notifications/size-changed"],
  );
  assert.deepEqual(sent[2].params, { width: 640, height: 480 });

  sent.length = 0;
  await deliver({ jsonrpc: "2.0", id: 8, method: "ping", params: {} });
  await deliver({
    jsonrpc: "2.0",
    id: 9,
    method: "ui/resource-teardown",
    params: {},
  });
  await deliver({ jsonrpc: "2.0", id: 10, method: "host/unknown", params: {} });
  await deliver({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-input",
    params: {},
  });
  assert.deepEqual(sent, [
    { jsonrpc: "2.0", id: 8, result: {} },
    { jsonrpc: "2.0", id: 9, result: {} },
    {
      jsonrpc: "2.0",
      id: 10,
      error: { code: -32601, message: "Method not found." },
    },
  ]);
});

test("returns the plotted values to the model by default", async () => {
  const reply = await simulate({ request: { template: "pulley" } });
  const result = reply.structuredContent;
  assert.ok(result.series.length > 0);
  assert.ok(result.series.every((graph) => graph.t.length <= 40));
  assert.ok(JSON.stringify(result).length < 20000);
  assert.equal(reply._meta, undefined);
});

test("sends the graphs to the chart view when it is on", async () => {
  const call = async (args) =>
    (
      await (
        await rpc(
          "tools/call",
          { name: "simulate_scene", arguments: args },
          { worker: viewEnv },
        )
      ).json()
    ).result;
  const both = await call({ request: { template: "pulley" } });
  assert.deepEqual(both.structuredContent.series, both._meta.graphs);
  const viewOnly = await call({
    request: { template: "pulley" },
    series: false,
  });
  assert.equal(viewOnly.structuredContent.series, undefined);
  assert.ok(viewOnly._meta.graphs.every((graph) => graph.t.length <= 120));
  assert.ok(viewOnly._meta.graphs.some((graph) => graph.t.length > 40));
});
