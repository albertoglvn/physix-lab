import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatGPTSetup, chatgptPlugins, setupSteps } from "./ChatGPTSetup";

const address = "https://example.test/mcp/open";
const prompt = "Using Physix, simulate a block.";

describe("ChatGPT setup steps", () => {
  const steps = setupSteps(address, prompt);
  const html = steps.map(({ body }) => renderToStaticMarkup(<>{body}</>));

  it("walks through ChatGPT's custom MCP server flow in order", () => {
    expect(steps.map(({ title }) => title)).toEqual([
      "Open Plugins in ChatGPT",
      "Add a custom MCP server",
      "Fill in the form",
      "Create the plugin",
      "Try an experiment",
    ]);
    expect(html[1]).toContain("<b>Add custom MCP server</b>");
    expect(html[3]).toContain("<b>Create as plugin</b>");
  });

  it("opens ChatGPT plugins in a new tab", () => {
    expect(chatgptPlugins).toBe("https://chatgpt.com/plugins");
    expect(html[0]).toContain(`href="${chatgptPlugins}"`);
    expect(html[0]).toContain('target="_blank"');
  });

  it("gives every form value with a copy button and no sign-in", () => {
    expect(html[2]).toContain("<code>Physix</code>");
    expect(html[2]).toContain(`<code>${address}</code>`);
    expect(html[2]).toContain("Copy address");
    expect(html[2]).toContain("<b>No authentication</b>");
  });

  it("ends with the example prompt to paste", () => {
    expect(html[4]).toContain(prompt);
    expect(html[4]).toContain("Copy example prompt");
  });
});

describe("the setup sheet", () => {
  const render = (open: boolean) =>
    renderToStaticMarkup(
      <ChatGPTSetup
        address={address}
        prompt={prompt}
        open={open}
        onOpenChange={() => {}}
      />,
    );

  it("stays closed until the page opens it, with one button to open it", () => {
    const html = render(false);
    expect(html).toContain("<span>Add Physix to ChatGPT</span>");
    expect(html).not.toContain("Step 1 of 5");
  });

  it("opens on the first step when the page sets it open", () => {
    const html = render(true);
    expect(html).toContain("Step 1 of 5");
    expect(html).toContain("Open Plugins in ChatGPT");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Back<\/button>/);
    expect(html).toContain(">Next</button>");
  });
});
