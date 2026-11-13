import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

const env = {
  ASSETS: { fetch: () => new Response("lab") },
  PHYSIX_CHATGPT_PLUGIN_URL: "https://chatgpt.com/plugins?view=personal",
};
const site = "https://physix.example";

function rpc(method, params, { signedIn = true, headers = {} } = {}) {
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
    env,
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
    ["describe_domain", "compare_stress"],
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
