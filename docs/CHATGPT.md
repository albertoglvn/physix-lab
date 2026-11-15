# Connect Physix to ChatGPT

1. Open [Physix](https://physix-lab.hospitablepeacock.chatgpt.site/) and select
   **Connect your agent**. Under **In ChatGPT**, select **Sign in with ChatGPT** and sign in
   with the ChatGPT account that has access to the Physix plugin.
2. After signing in, select **Open ChatGPT plugins**. In **Personal**, open **Physix** under
   **Created by you** or **Shared with me**. Select **Install**, then **Connect** if prompted.
3. Start a new ChatGPT Work chat, select **@Physix**, and ask:

   > Compare 12 mm and 18 mm hole radii on the Physix example plate. Keep the load
   > the same. Report the von Mises hotspot and the source for each case.

The Site handles sign-in. ChatGPT handles installation and connection consent. The
public browser lab stays available to visitors. The Site provisions a private plugin
for the owner. The plugin is not public yet because public plugin directory distribution
requires OpenAI review. Until then it works only for the owner's account, and anyone else
can reach the same tools through the [open address](#connect-any-mcp-client).
[MCP setup in ChatGPT](https://learn.chatgpt.com/docs/extend/mcp) ·
[Public submission](https://developers.openai.com/plugins/deploy/submission)

## Test it as a judge

You can test Physix in four ways:

- **In the browser.** Open the [lab](https://physix-lab.hospitablepeacock.chatgpt.site/).
  You need no account.
- **In your own ChatGPT.** Open the Site, select **Connect your agent**, then
  **Add Physix to ChatGPT**. Five steps with **Next** buttons add the open address as a
  custom MCP server: open **Plugins**, select **Add** and **Add custom MCP server**, enter
  the name `Physix`, the server URL and **No authentication**, tick
  **I understand and want to continue** and select **Create as plugin**. The last step
  gives an example prompt to paste. Your plan or workspace must allow custom MCP servers.
- **With your own agent.** Open the Site, select **Connect your agent** and copy the
  address, or take it from [Connect any MCP client](#connect-any-mcp-client). Add it to
  Codex or any MCP client. You need no account or sign-in.
- **From a clone.** After the [Quick start](../README.md#quick-start) setup, run
  `pnpm --filter @physix/web run lab --preset pulley 60`. It runs a Motion template with the
  same engine as the hosted tools and prints its measurements as JSON. The local MCP server
  in [Connect an agent](../README.md#connect-an-agent) serves `predict_stress`,
  `verify_with_solver` and `optimize`.

## Changes after the submission

The project was submitted at 5 pm on 14 November 2026 (UTC−6). The ChatGPT plugin needs
OpenAI review before it can be public, so judges could not install it. The only change
after the submission makes the same hosted tools reachable from any MCP client instead:

| When (UTC−6) | Change |
| --- | --- |
| 14 Nov, 16:48 | `d4db096` added `/mcp/open` to the Worker, before the submission. The live Site still ran the earlier build. |
| 14 Nov, 17:04 | `01b24a5` noted in the docs that the address goes live with the next publish. |
| 15 Nov, 00:11 | The Site was published as version 19 from `01b24a5`, and `/mcp/open` went live. |
| 15 Nov, 00:28 | `3ad4245`, published as version 20: **Connect your agent** on the Site now shows the open address with a copy button, and these docs point judges to it. |
| 15 Nov | **Add Physix to ChatGPT** on the Site walks through adding the open address to ChatGPT as a custom MCP server, step by step. |

The lab, the engine and the four tools are unchanged. `/mcp` still requires a ChatGPT
sign-in.

## Connect any MCP client

The Site also serves the same four tools without a ChatGPT sign-in, so you can try Physix
with your own agent:

```text
https://physix-lab.hospitablepeacock.chatgpt.site/mcp/open
```

The published Site (version 19) serves it from commit `01b24a5`. Checked without a sign-in:
`initialize` and `tools/list` return the four tools, `simulate_scene` on a 5 kg block on a
30° ramp with μ = 0.25 returns source `rapier` with acceleration 2.781 m/s² against
2.781 m/s² in theory, and `/mcp` still returns 401.

Use it from any MCP client that connects to a remote server over HTTP. In Codex, add it to
`~/.codex/config.toml`:

```toml
[mcp_servers.physix]
url = "https://physix-lab.hospitablepeacock.chatgpt.site/mcp/open"
```

Then ask your agent:

> Using Physix, simulate a 5 kg block sliding down a 30° ramp with friction 0.25 and
> check its acceleration against theory.

The open address answers like `/mcp`, with three differences:

- It needs no sign-in and reads no identity.
- It never names the chart view. Results carry the plotted `series` for your agent to plot.
- Set the Worker's `PHYSIX_OPEN_MCP` variable to `off` to close it. It then returns 404.

Both addresses take requests of up to 16 KB and apply the scene and run limits that
`describe_domain` lists. Neither stores a request.

## Hosted stress experiments

- `describe_domain` returns the reference plate and L-bracket dimensions, materials,
  load direction, and available hole radii.
- `compare_stress` compares up to six cases from that set. Pass radii in metres.
  A positive multiplier
  scales the reference load, stress and displacement. Geometry, material and
  boundary conditions stay fixed for each radius. Values are reference-mesh
  summaries, with the reference case ID, solver version, and mesh size.
- Each `compare_stress` result has a `share_url`. The link opens that exact case in the
  Physix lab, where the student can see the stress field, probe it, and check it with FEM.
  The case travels in the URL fragment (`physix.share/1` in `docs/CONTRACTS.md`), so the
  Worker stores nothing and the host never receives it.
- `build_scene` builds a Motion experiment from parts: blocks, balls and cylinders on
  ramps or the floor, Atwood pulleys (with an optional spring under one weight),
  pendulums, springs, spring bumpers, launches, applied forces and air drag. ChatGPT gives
  only the values the problem states; the result lists the defaults it used. The Worker validates the scene with the lab's own code
  (`physix.scene-request/1` in `docs/CONTRACTS.md`) and returns a `share_url`. It does not
  simulate it: the lab runs the simulation and plots its graphs in the browser when the
  link opens.
- `simulate_scene` takes the same request, or a scene from `build_scene`, and runs it on the
  server with the lab's engine (Rapier). ChatGPT receives the events, the closed-form theory
  values beside the simulated ones, the start, end, min and max of each plotted quantity, and
  a `share_url`. It also receives the plotted values, 40 samples per graph by default, and
  plots them itself (`physix.hosted-run/1` in `docs/CONTRACTS.md`). The lab recomputes the
  run and shows interactive graphs when the link opens.
- ChatGPT does not open MCP Apps views from a Sites-hosted plugin: the Physix chart view
  failed with "could not open" in regular and Work chats while its resource was served
  correctly. The view stays in `mcp/sites/chartView.mjs`, off unless the Worker's
  `PHYSIX_CHART_VIEW` variable is `on`.
- Hosted stress tools expose cached scikit-fem results and their linear scaling. Arbitrary
  geometry, new FEM meshes and optimization are available through the local tools or the
  browser lab within each workflow's scope.

Try:

> Using Physix, set up a 5 kg block on a 30° ramp with friction 0.25 and give me the link.

> Using Physix, simulate a 5 kg block sliding down a 30° ramp with friction 0.25. Show me
> its velocity and energy graphs and check the acceleration against theory.

## Build and verification

Run `pnpm run build` from the root to build the browser assets and Sites Worker.
`scripts/build_sites_worker.mjs` bundles the Worker with Vite into one module, with the
lab's scene builder, motion run, chart view and stress reference inlined. Workers refuse to
compile WebAssembly from bytes, so the build swaps Rapier's inlined module for an import of
`rapier3d.wasm`, copies that file beside `index.js`, and adds a `CompiledWasm` rule to
`wrangler.json`. The build fails if any other import remains or the inlined module is
still present. The deployed Worker therefore needs the `.wasm` module rule honoured. If
the engine cannot start, `simulate_scene` returns `engine_unavailable` with the
`share_url`, and the stress and scene tools keep working.

Measured timings for `simulate_scene`, end to end through the MCP endpoint, on the built
bundle in local workerd (miniflare 4.20260730, AMD Ryzen 9 7940HS, Windows 11): the incline
template took 118 ms cold and 29 ms warm; 60 s runs took 133 ms for the pulley, 325 ms for
the collision template and 865 ms for 32 balls, the largest scene. The model-visible result,
with the plotted values at the default 40 samples per graph, was 8 to 12 KB for the
templates and 34 KB for 32 balls. The bundle is 455 KB (95 KB gzipped) and
`rapier3d.wasm` 3.1 MB. A deployed Worker may report a lower `wall_ms`, since its clock can
advance only at I/O. A run that exceeds the platform's CPU limit ends the request without
a tool result.
The plugin address `/mcp` uses the platform's request identity, never collects a separate
password, and returns only a signed-in flag and optional plugin link to the browser. The
open address `/mcp/open` reads no identity. The Worker does not log identities or
experiment inputs.

The hosted reference file is generated by `uv run --no-sync python -m scripts.build_hosted_stress`
from canonical cases using the documented reference mesh. Run
`node --test mcp/sites/worker.test.mjs` for the hosted MCP transport, tool and access
tests. Node 22.18 loads the scene builder's and motion run's TypeScript directly for
these tests, with the engine's package as published.
Run `uv run --no-sync pytest tests/mcp/test_hosted_reference.py` to compare scaled
hosted cases with independent matched scikit-fem solves. The test checks that the hosted
reference matches a fresh solve within a relative tolerance of `1e-5` across platforms
for peak and hotspot von Mises stress.

`PHYSIX_CHATGPT_PLUGIN_URL` is an optional nonsecret Sites runtime variable for a
verified ChatGPT plugin details link. Until a direct link is available, the button
opens the Personal plugins directory.
