/**
 * The chat chart view: an MCP Apps UI resource (`text/html;profile=mcp-app`) that ChatGPT
 * renders under a simulate_scene or compare_stress result. It is one self-contained page
 * with no network access. It reads the result from the MCP Apps bridge
 * (`ui/notifications/tool-result`) or, in ChatGPT, from `window.openai`, and plots the
 * graphs the result's `_meta` carries. Change the URI when the page changes incompatibly,
 * since hosts cache it by URI.
 */
export const CHART_VIEW_URI = "ui://physix/chart-v3.html";
export const CHART_VIEW_MIME = "text/html;profile=mcp-app";

/** Runs inside the view's iframe; it is serialized into the page, so it uses no imports. */
function chartView() {
  const SVG = "http://www.w3.org/2000/svg";
  const root = document.getElementById("root");
  const pending = new Map();
  let nextId = 1;
  let initialized = false;
  let canOpenLinks = false;
  let shown = "";
  let current = null;

  const post = (message) => window.parent.postMessage(message, "*");
  const notify = (method, params) => post({ jsonrpc: "2.0", method, params });
  function request(method, params) {
    const id = nextId++;
    post({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) =>
      pending.set(id, { resolve, reject }),
    );
  }

  function setTheme(theme) {
    if (theme === "light" || theme === "dark")
      document.documentElement.dataset.theme = theme;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }
  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, String(value));
    return node;
  }

  function fmt(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
      return "–";
    const size = Math.abs(value);
    if (size !== 0 && (size >= 1e5 || size < 1e-3))
      return value.toExponential(2);
    return String(Number(value.toPrecision(4)));
  }
  const withUnit = (value, unit) =>
    unit && Number.isFinite(value) ? `${fmt(value)} ${unit}` : fmt(value);

  function openLink(url) {
    if (!url) return;
    if (canOpenLinks)
      return void request("ui/open-link", { url }).catch(() =>
        fallbackOpen(url),
      );
    fallbackOpen(url);
  }
  function fallbackOpen(url) {
    if (window.openai?.openExternal) window.openai.openExternal({ href: url });
    else window.open(url, "_blank", "noopener");
  }

  /** Finds the graphs in the result `_meta`, however the host wraps it. */
  function graphsOf(meta) {
    for (const candidate of [
      meta,
      meta?._meta,
      meta?.mcp_tool_result?._meta,
      meta?.call_tool_result?._meta,
    ])
      if (Array.isArray(candidate?.graphs)) return candidate.graphs;
    return null;
  }

  function show(structured, meta) {
    if (!structured || typeof structured !== "object") return;
    const graphs = graphsOf(meta);
    const key = JSON.stringify([
      structured.run?.id ?? structured.results?.map((r) => r.share_url),
      !!graphs,
    ]);
    if (key === shown) return;
    shown = key;
    current = { structured, graphs };
    render();
  }

  function render() {
    if (!current) return;
    const { structured, graphs } = current;
    root.replaceChildren();
    if (structured.error) {
      root.append(
        el("p", {
          class: "error",
          text: structured.message || structured.error,
        }),
      );
      if (structured.share_url) root.append(openButton(structured.share_url));
    } else if (structured.schema === "physix.hosted-run/1")
      renderRun(structured, graphs);
    else if (structured.schema === "physix.hosted-stress/1")
      renderStress(structured);
    else root.append(el("p", { class: "muted", text: "Nothing to plot." }));
  }

  const openButton = (url) =>
    el("button", {
      type: "button",
      class: "open",
      text: "Open in Physix lab",
      onclick: () => openLink(url),
    });

  function renderRun(result, graphs) {
    const stop = result.run.stop;
    const ended =
      stop.reason === "event"
        ? `stopped on ${stop.event}`
        : "reached the time limit";
    root.append(
      el(
        "header",
        {},
        el(
          "div",
          {},
          el("h1", { text: result.scene.name }),
          el("p", {
            class: "muted",
            text: `Simulated with Rapier ${result.run.engine.version} at ${fmt(1 / result.run.time_step_s)} steps/s; ${ended} at t = ${fmt(stop.t)} s.`,
          }),
        ),
        result.share_url && openButton(result.share_url),
      ),
    );
    if (result.references.length)
      root.append(referenceTable(result.references));
    if (graphs?.length) {
      const grid = el("div", { class: "grid" });
      for (const graph of graphs) grid.append(chart(graph));
      root.append(grid);
    } else if (result.summary.length) root.append(summaryTable(result.summary));
    if (result.events.length)
      root.append(
        el(
          "p",
          { class: "muted events" },
          "Events: " +
            result.events
              .map(
                (e) =>
                  `${e.label.toLowerCase()} (${e.target}) at ${fmt(e.t)} s`,
              )
              .join("; ") +
            (result.events_omitted ? `; ${result.events_omitted} more` : "") +
            ".",
        ),
      );
  }

  function referenceTable(references) {
    const body = el("tbody");
    for (const ref of references) {
      const status = ref.broken
        ? ["Assumption not met", "warn"]
        : ref.within === null
          ? ["Not reached", "warn"]
          : ref.within
            ? ["✓ Within tolerance", "ok"]
            : ["✗ Outside tolerance", "bad"];
      const difference =
        ref.difference === null
          ? "–"
          : ref.relative
            ? `${fmt(ref.difference * 100)} %`
            : withUnit(ref.difference, ref.unit);
      body.append(
        el(
          "tr",
          { title: ref.broken || ref.assumptions.join(" ") },
          el(
            "td",
            {},
            `${ref.label} (${ref.target})`,
            el("div", { class: "muted formula", text: ref.formula }),
          ),
          el("td", { class: "num", text: withUnit(ref.theory, ref.unit) }),
          el("td", { class: "num", text: withUnit(ref.measured, ref.unit) }),
          el("td", { class: "num", text: difference }),
          el("td", { class: `status ${status[1]}`, text: status[0] }),
        ),
      );
    }
    return el(
      "section",
      {},
      el("h2", { text: "Theory check" }),
      el(
        "div",
        { class: "scroll" },
        el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", { text: "Quantity" }),
              el("th", { class: "num", text: "Theory" }),
              el("th", { class: "num", text: "Simulated" }),
              el("th", { class: "num", text: "Difference" }),
              el("th", { text: "" }),
            ),
          ),
          body,
        ),
      ),
    );
  }

  function summaryTable(summary) {
    const body = el("tbody");
    for (const row of summary)
      body.append(
        el(
          "tr",
          {},
          el("td", { text: row.key }),
          el("td", { class: "num", text: withUnit(row.start, row.unit) }),
          el("td", { class: "num", text: withUnit(row.end, row.unit) }),
          el("td", { class: "num", text: withUnit(row.min, row.unit) }),
          el("td", { class: "num", text: withUnit(row.max, row.unit) }),
        ),
      );
    return el(
      "section",
      {},
      el("h2", { text: "Summary" }),
      el(
        "div",
        { class: "scroll" },
        el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              ...["Column", "Start", "End", "Min", "Max"].map((label, i) =>
                el("th", { class: i ? "num" : "", text: label }),
              ),
            ),
          ),
          body,
        ),
      ),
    );
  }

  function ticks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
    const list = [];
    for (
      let v = Math.ceil(min / step) * step;
      v <= max + step * 1e-9;
      v += step
    )
      list.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return list;
  }

  function extent(values) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values)
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    if (min === Infinity) return [0, 1];
    if (min === max)
      return [
        min - (Math.abs(min) || 1) * 0.1,
        max + (Math.abs(max) || 1) * 0.1,
      ];
    const pad = (max - min) * 0.06;
    return [min - pad, max + pad];
  }

  /** A line chart of one graph: simulated lines solid, theory dashed, one y-axis. */
  function chart(graph) {
    const card = el("figure", { class: "card" });
    const width = Math.max(240, Math.min(chartWidth() - 22, 640));
    const height = 190;
    const m = { left: 52, right: 12, top: 10, bottom: 30 };
    const t = graph.t;
    const all = graph.series.flatMap((s) => [...s.values, ...(s.theory ?? [])]);
    const [y0, y1] = extent(all);
    const tMax = t[t.length - 1] || 1;
    const x = (v) => m.left + (v / tMax) * (width - m.left - m.right);
    const y = (v) =>
      m.top + (1 - (v - y0) / (y1 - y0)) * (height - m.top - m.bottom);
    const plot = svg("svg", {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `${graph.title}, ${graph.unit} against time`,
    });
    for (const v of ticks(y0, y1, 4)) {
      plot.append(
        svg("line", {
          class: "gridline",
          x1: m.left,
          x2: width - m.right,
          y1: y(v),
          y2: y(v),
        }),
      );
      const label = svg("text", {
        class: "tick",
        x: m.left - 6,
        y: y(v) + 4,
        "text-anchor": "end",
      });
      label.textContent = fmt(v);
      plot.append(label);
    }
    for (const v of ticks(0, tMax, 5)) {
      const label = svg("text", {
        class: "tick",
        x: x(v),
        y: height - m.bottom + 16,
        "text-anchor": "middle",
      });
      label.textContent = fmt(v);
      plot.append(label);
    }
    plot.append(
      svg("line", {
        class: "axis",
        x1: m.left,
        x2: width - m.right,
        y1: height - m.bottom,
        y2: height - m.bottom,
      }),
    );
    const axisLabel = svg("text", {
      class: "tick",
      x: width - m.right,
      y: height - 2,
      "text-anchor": "end",
    });
    axisLabel.textContent = "t (s)";
    plot.append(axisLabel);

    const path = (values) => {
      let d = "";
      let pen = false;
      values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return void (pen = false);
        d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    graph.series.forEach((series, i) => {
      if (series.theory)
        plot.append(
          svg("path", {
            class: `line theory s${i + 1}`,
            d: path(series.theory),
          }),
        );
      plot.append(
        svg("path", { class: `line s${i + 1}`, d: path(series.values) }),
      );
    });

    const cursor = svg("line", {
      class: "cursor",
      y1: m.top,
      y2: height - m.bottom,
      visibility: "hidden",
    });
    const dots = graph.series.map((_, i) => {
      const dot = svg("circle", {
        class: `dot s${i + 1}`,
        r: 4,
        visibility: "hidden",
      });
      plot.append(dot);
      return dot;
    });
    plot.append(cursor);
    const tip = el("div", { class: "tip", hidden: "" });
    const hit = svg("rect", {
      x: m.left,
      y: m.top,
      width: width - m.left - m.right,
      height: height - m.top - m.bottom,
      fill: "transparent",
    });
    plot.append(hit);
    const hide = () => {
      cursor.setAttribute("visibility", "hidden");
      for (const dot of dots) dot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    };
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("pointermove", (event) => {
      const box = plot.getBoundingClientRect();
      const time =
        ((event.clientX - box.left - m.left) / (width - m.left - m.right)) *
        tMax;
      let index = 0;
      for (let i = 1; i < t.length; i++)
        if (Math.abs(t[i] - time) < Math.abs(t[index] - time)) index = i;
      const px = x(t[index]);
      cursor.setAttribute("x1", px);
      cursor.setAttribute("x2", px);
      cursor.setAttribute("visibility", "visible");
      tip.replaceChildren(
        el("div", { class: "muted", text: `t = ${fmt(t[index])} s` }),
      );
      graph.series.forEach((series, i) => {
        const v = series.values[index];
        dots[i].setAttribute("cx", px);
        dots[i].setAttribute("cy", y(v));
        dots[i].setAttribute("visibility", "visible");
        const theory = series.theory?.[index];
        tip.append(
          el(
            "div",
            {},
            el("span", { class: `swatch s${i + 1}` }),
            `${series.label}: ${withUnit(v, graph.unit)}`,
            theory === null || theory === undefined
              ? ""
              : ` (theory ${fmt(theory)})`,
          ),
        );
      });
      tip.hidden = false;
      tip.style.left = `${Math.min(px + 10, width - 170)}px`;
    });

    const legend = el("div", { class: "legend" });
    if (graph.series.length > 1 || graph.series.some((s) => s.theory))
      graph.series.forEach((series, i) => {
        legend.append(
          el(
            "span",
            {},
            el("span", { class: `swatch s${i + 1}` }),
            `${series.label} (${series.symbol})`,
          ),
        );
        if (series.theory)
          legend.append(
            el(
              "span",
              {},
              el("span", { class: `swatch dashed s${i + 1}` }),
              "theory",
            ),
          );
      });

    const table = el("details", {}, el("summary", { text: "Table" }));
    table.addEventListener("toggle", () => {
      if (table.querySelector("table")) return;
      const head = el(
        "tr",
        {},
        el("th", { class: "num", text: "t (s)" }),
        ...graph.series.map((s) =>
          el("th", { class: "num", text: `${s.symbol} (${graph.unit})` }),
        ),
      );
      const body = el("tbody");
      t.forEach((time, i) =>
        body.append(
          el(
            "tr",
            {},
            el("td", { class: "num", text: fmt(time) }),
            ...graph.series.map((s) =>
              el("td", { class: "num", text: fmt(s.values[i]) }),
            ),
          ),
        ),
      );
      table.append(
        el(
          "div",
          { class: "scroll rows" },
          el("table", {}, el("thead", {}, head), body),
        ),
      );
    });

    card.append(
      el(
        "figcaption",
        {},
        `${graph.title} `,
        el("span", { class: "muted", text: `(${graph.unit})` }),
      ),
      legend,
      el("div", { class: "plot" }, plot, tip),
      table,
    );
    return card;
  }

  function chartWidth() {
    const full = root.clientWidth || 600;
    return full >= 640 ? (full - 12) / 2 : full;
  }

  function renderStress(result) {
    const rows = result.results;
    root.append(
      el(
        "header",
        {},
        el(
          "div",
          {},
          el("h1", { text: `Stress comparison: ${result.family}` }),
          el("p", {
            class: "muted",
            text: "Hotspot von Mises stress from scikit-fem reference runs, scaled linearly with the load.",
          }),
        ),
      ),
    );
    const width = Math.min(root.clientWidth || 600, 640);
    const bar = 26;
    const m = { left: 118, right: 70 };
    const height = rows.length * (bar + 10) + 10;
    const max = Math.max(...rows.map((r) => r.summary.hotspot.von_mises)) || 1;
    const plot = svg("svg", {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": "Hotspot von Mises stress per case",
    });
    rows.forEach((row, i) => {
      const top = 10 + i * (bar + 10);
      const value = row.summary.hotspot.von_mises / 1e6;
      const length =
        ((width - m.left - m.right) * row.summary.hotspot.von_mises) / max;
      const name = svg("text", {
        class: "tick",
        x: m.left - 8,
        y: top + bar / 2 + 4,
        "text-anchor": "end",
      });
      name.textContent = `r = ${fmt(row.radius_m * 1000)} mm × ${fmt(row.load_multiplier)}`;
      const rect = svg("rect", {
        class: "bar s1",
        x: m.left,
        y: top,
        width: Math.max(2, length),
        height: bar,
        rx: 4,
      });
      const title = svg("title");
      title.textContent = `${fmt(value)} MPa`;
      rect.append(title);
      const label = svg("text", {
        class: "tick",
        x: m.left + length + 6,
        y: top + bar / 2 + 4,
      });
      label.textContent = `${fmt(value)} MPa`;
      plot.append(name, rect, label);
    });
    const body = el("tbody");
    for (const row of rows)
      body.append(
        el(
          "tr",
          {},
          el("td", {
            text: `r = ${fmt(row.radius_m * 1000)} mm × ${fmt(row.load_multiplier)}`,
          }),
          el("td", {
            class: "num",
            text: `${fmt(row.summary.hotspot.von_mises / 1e6)} MPa`,
          }),
          el("td", {
            class: "num",
            text: `${fmt(row.summary.max_von_mises / 1e6)} MPa`,
          }),
          el(
            "td",
            {},
            row.share_url
              ? el("button", {
                  type: "button",
                  class: "link",
                  text: "Open",
                  onclick: () => openLink(row.share_url),
                })
              : "",
          ),
        ),
      );
    root.append(
      el(
        "figure",
        { class: "card" },
        el("figcaption", { text: "Hotspot von Mises stress" }),
        el("div", { class: "plot" }, plot),
      ),
      el(
        "div",
        { class: "scroll" },
        el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", { text: "Case" }),
              el("th", { class: "num", text: "Hotspot" }),
              el("th", { class: "num", text: "Peak" }),
              el("th", { text: "Lab" }),
            ),
          ),
          body,
        ),
      ),
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (!message.method && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(message.error);
      else resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-result")
      show(message.params?.structuredContent, message.params?._meta);
    else if (message.method === "ui/notifications/host-context-changed")
      setTheme(message.params?.theme);
    // Every host request gets an answer, so the host never waits on the view.
    if (message.id === undefined || typeof message.method !== "string") return;
    if (message.method === "ping" || message.method === "ui/resource-teardown")
      post({ jsonrpc: "2.0", id: message.id, result: {} });
    else
      post({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found." },
      });
  });

  function fromGlobals() {
    const openai = window.openai;
    if (!openai) return;
    setTheme(openai.theme);
    if (openai.toolOutput) show(openai.toolOutput, openai.toolResponseMetadata);
  }
  window.addEventListener("openai:set_globals", fromGlobals);
  fromGlobals();

  let lastWidth = 0;
  new ResizeObserver(() => {
    const width = root.clientWidth;
    if (Math.abs(width - lastWidth) > 24 && current) {
      lastWidth = width;
      render();
    }
    if (initialized) sendSize();
  }).observe(document.body);
  function sendSize() {
    notify("ui/notifications/size-changed", {
      width: Math.ceil(document.documentElement.scrollWidth),
      height: Math.ceil(document.documentElement.scrollHeight),
    });
  }

  // MCP Apps 2026-01-26: the view names itself with appInfo, then confirms with initialized.
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "physix-chart", version: "2.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  })
    .then((result) => {
      setTheme(result?.hostContext?.theme);
      canOpenLinks = !!result?.hostCapabilities?.openLinks;
      initialized = true;
      notify("ui/notifications/initialized", {});
      sendSize();
    })
    .catch(() => {});
}

const STYLE = `
:root {
  color-scheme: light;
  --surface: #ffffff;
  --card: #f9fbf7;
  --ink: #263229;
  --muted: #59695d;
  --rule: #dce4da;
  --grid: #e7ede6;
  --ok: #357448;
  --warn: #875c15;
  --bad: #a13e36;
  --s1: #2a7a52;
  --s2: #0081c0;
  --s3: #b07a1a;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface: #212121;
    --card: #2a2a2a;
    --ink: #eceeea;
    --muted: #b4bcb4;
    --rule: #3d423e;
    --grid: #343835;
    --ok: #6cc08a;
    --warn: #d9a94a;
    --bad: #ec8a80;
    --s1: #3d9b6b;
    --s2: #3a8ee6;
    --s3: #c48722;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #212121;
  --card: #2a2a2a;
  --ink: #eceeea;
  --muted: #b4bcb4;
  --rule: #3d423e;
  --grid: #343835;
  --ok: #6cc08a;
  --warn: #d9a94a;
  --bad: #ec8a80;
  --s1: #3d9b6b;
  --s2: #3a8ee6;
  --s3: #c48722;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--surface); color: var(--ink); }
body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
#root { padding: 12px; display: grid; gap: 14px; }
header { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
h1 { font-size: 16px; margin: 0; }
h2 { font-size: 13px; margin: 0 0 6px; }
p { margin: 2px 0 0; }
.muted { color: var(--muted); }
.error { color: var(--bad); }
.events { font-size: 12px; }
button.open { font: inherit; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--rule); background: var(--card); color: var(--ink); cursor: pointer; }
button.open:hover, button.link:hover { border-color: var(--muted); }
button.link { font: inherit; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--rule); background: none; color: var(--ink); cursor: pointer; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.card { margin: 0; padding: 10px; background: var(--card); border: 1px solid var(--rule); border-radius: 10px; min-width: 0; }
figcaption { font-weight: 600; font-size: 13px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); margin: 4px 0; }
.swatch { display: inline-block; width: 14px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 5px; }
.swatch.dashed { border-top-style: dashed; }
.swatch.s1 { border-color: var(--s1); } .swatch.s2 { border-color: var(--s2); } .swatch.s3 { border-color: var(--s3); }
.plot { position: relative; overflow: hidden; }
svg { display: block; max-width: 100%; height: auto; }
line.gridline { stroke: var(--grid); stroke-width: 1; }
line.axis { stroke: var(--rule); }
.tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.line.theory { stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.85; }
.line.s1 { stroke: var(--s1); } .line.s2 { stroke: var(--s2); } .line.s3 { stroke: var(--s3); }
.bar.s1 { fill: var(--s1); }
.dot { stroke: var(--card); stroke-width: 2; }
.dot.s1 { fill: var(--s1); } .dot.s2 { fill: var(--s2); } .dot.s3 { fill: var(--s3); }
.cursor { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 3; }
.tip { position: absolute; top: 6px; min-width: 150px; padding: 6px 8px; font-size: 12px; background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; pointer-events: none; }
.scroll { overflow-x: auto; }
.scroll.rows { max-height: 220px; overflow-y: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.formula { font-size: 11.5px; }
.status { white-space: nowrap; font-weight: 600; }
.status.ok { color: var(--ok); } .status.warn { color: var(--warn); } .status.bad { color: var(--bad); }
details summary { cursor: pointer; font-size: 12px; color: var(--muted); margin-top: 4px; }
`;

export const CHART_VIEW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Physix chart</title>
<style>${STYLE}</style>
</head>
<body>
<div id="root"><p class="muted">Waiting for the experiment…</p></div>
<script>(${chartView.toString()})();</script>
</body>
</html>
`;
