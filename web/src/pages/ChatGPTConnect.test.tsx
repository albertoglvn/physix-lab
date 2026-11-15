import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatGPTConnect, codexConfig, openMcpUrl } from "./ChatGPTConnect";
import { Home } from "./Home";

describe("connect section", () => {
  const html = renderToStaticMarkup(<ChatGPTConnect />);

  it("offers the open MCP address first, with no sign-in", () => {
    expect(openMcpUrl).toBe(
      "https://physix-lab.hospitablepeacock.chatgpt.site/mcp/open",
    );
    expect(html).toContain(`<code>${openMcpUrl}</code>`);
    expect(html).toContain("Copy address");
    expect(html).toContain("You need no sign-in.");
    expect(html.indexOf(openMcpUrl)).toBeLessThan(html.indexOf("In ChatGPT"));
  });

  it("gives a Codex config that names the same address", () => {
    expect(codexConfig).toBe(`[mcp_servers.physix]\nurl = "${openMcpUrl}"`);
    expect(html).toContain("Copy Codex config");
  });

  it("keeps ChatGPT for accounts with plugin access", () => {
    expect(html).toContain(
      "The Physix plugin for ChatGPT is not public yet because it needs",
    );
    expect(html).toContain("Add Physix to ChatGPT");
    expect(html).toContain("Checking your sign-in…");
  });
});

it("sends every Connect your agent button to the connect section", () => {
  const html = renderToStaticMarkup(<Home route="/" />);
  const buttons = [
    ...html.matchAll(
      /<a[^>]*href="([^"]*)"[^>]*><span>Connect your agent<\/span>/g,
    ),
  ];
  expect(buttons.length).toBe(2);
  for (const [, href] of buttons) expect(href).toBe("#/connect");
  expect(html).not.toContain("/connect/start");
});
