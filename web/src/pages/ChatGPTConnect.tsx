import { useEffect, useState } from "react";
import { CopyButton } from "../ui/controls";
import { Action } from "../ui/pastoral";

type Connection =
  | { state: "loading" | "unavailable" }
  | { state: "ready"; signedIn: boolean; pluginUrl: string | null };

const returnTo = encodeURIComponent("/connect");
const personalPlugins = "https://chatgpt.com/plugins?view=personal";
const example =
  "Use Physix to compare 12 mm and 18 mm hole radii on the example plate. Keep the load the same. Report the von Mises hotspot and the source for each case.";

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
        <h2 id="connect-title">Connect Physix to ChatGPT</h2>
        <p>
          Run a stress experiment from your chat. Compare supported hole sizes
          and loads on a plate or bracket using scikit-fem reference results.
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
        <h3>Try a stress experiment</h3>
        <p>{example}</p>
        <CopyButton text={example} label="Copy example prompt" />
      </div>
    </section>
  );
}
