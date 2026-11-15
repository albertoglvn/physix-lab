import { useEffect, useState } from "react";
import { CopyButton } from "../ui/controls";
import { Action } from "../ui/pastoral";

type Connection =
  | { state: "loading" | "unavailable" }
  | { state: "ready"; signedIn: boolean; pluginUrl: string | null };

const returnTo = encodeURIComponent("/connect");
/** The hosted tools without a ChatGPT sign-in, for Codex and other MCP clients. */
export const openMcpUrl =
  "https://physix-lab.hospitablepeacock.chatgpt.site/mcp/open";
export const codexConfig = `[mcp_servers.physix]
url = "${openMcpUrl}"`;
const personalPlugins = "https://chatgpt.com/plugins?view=personal";
const examples = [
  {
    title: "Try a motion experiment",
    prompt:
      "Using Physix, simulate a 5 kg block sliding down a 30° ramp with friction 0.25. Show me its velocity and energy graphs and check the acceleration against theory.",
  },
  {
    title: "Try a stress experiment",
    prompt:
      "Use Physix to compare 12 mm and 18 mm hole radii on the example plate. Keep the load the same. Report the von Mises hotspot and the source for each case.",
  },
];

export function ChatGPTConnect() {
  const [connection, setConnection] = useState<Connection>({
    state: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/connection", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Connection status unavailable");
        const { signedIn, pluginUrl } = (await response.json()) as {
          signedIn?: unknown;
          pluginUrl?: unknown;
        };
        if (typeof signedIn !== "boolean")
          throw new Error("Invalid connection status");
        setConnection({
          state: "ready",
          signedIn,
          pluginUrl:
            typeof pluginUrl === "string" &&
            /^https:\/\/chatgpt\.com\/plugins(?:[/?#]|$)/.test(pluginUrl)
              ? pluginUrl
              : null,
        });
      } catch {
        if (!controller.signal.aborted) setConnection({ state: "unavailable" });
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return (
    <section
      className="home-connect home-editorial"
      id="connect"
      aria-labelledby="connect-title"
    >
      <div>
        <h2 id="connect-title">Connect your agent</h2>
        <p>
          Add Physix to Codex or any MCP client that connects to a remote
          server. You need no sign-in. Your agent can build and run motion
          experiments and check them against theory, or compare hole sizes and
          loads on a plate or bracket using scikit-fem reference results.
        </p>
        <div className="home-connect-address">
          <code>{openMcpUrl}</code>
          <CopyButton text={openMcpUrl} label="Copy address" />
        </div>
        <div className="home-connect-actions">
          <CopyButton text={codexConfig} label="Copy Codex config" />
        </div>
        <h3>In ChatGPT</h3>
        <p>
          The Physix plugin for ChatGPT is not public yet because it needs
          OpenAI review first. Until then, add the address above to your agent.
          If your ChatGPT account already has access, sign in to open it.
        </p>
        {connection.state === "loading" && (
          <p role="status">Checking your sign-in…</p>
        )}
        {connection.state === "unavailable" && (
          <p role="status">
            ChatGPT sign-in is unavailable here. You can still open the lab.
          </p>
        )}
        {connection.state === "ready" && (
          <div className="home-connect-actions">
            {connection.signedIn ? (
              <>
                <Action
                  href={connection.pluginUrl ?? personalPlugins}
                  target="_top"
                >
                  {connection.pluginUrl
                    ? "Open Physix in ChatGPT"
                    : "Open ChatGPT plugins"}
                </Action>
                <Action
                  href={`/signout-with-chatgpt?return_to=${returnTo}`}
                  target="_top"
                  variant="text"
                >
                  Sign out
                </Action>
              </>
            ) : (
              <Action
                href={`/signin-with-chatgpt?return_to=${returnTo}`}
                target="_top"
                variant="text"
              >
                Sign in with ChatGPT
              </Action>
            )}
          </div>
        )}
        {connection.state === "ready" && connection.signedIn && (
          <p>
            Find Physix under Personal plugins, then select Install and Connect.
            Access is available to the owner and users the plugin is shared
            with.
          </p>
        )}
      </div>
      <div className="home-connect-config">
        {examples.map(({ title, prompt }) => (
          <div key={title}>
            <h3>{title}</h3>
            <p>{prompt}</p>
            <CopyButton text={prompt} label="Copy example prompt" />
          </div>
        ))}
      </div>
    </section>
  );
}
