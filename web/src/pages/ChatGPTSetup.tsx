import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet } from "../lab/ui/Sheet";
import { CopyButton } from "../ui/controls";

/** Where a ChatGPT user adds a custom MCP server. */
export const chatgptPlugins = "https://chatgpt.com/plugins";

type Step = { title: string; body: ReactNode };

/**
 * The steps follow ChatGPT's own labels for adding a custom MCP server, so a reader can
 * match each one to the screen in front of them.
 */
export function setupSteps(address: string, prompt: string): Step[] {
  return [
    {
      title: "Open Plugins in ChatGPT",
      body: (
        <>
          <p>
            Open ChatGPT in a new tab and select <b>Plugins</b> in the sidebar.
            Keep this window open to follow the next steps.
          </p>
          <a
            className="setup-link"
            href={chatgptPlugins}
            target="_blank"
            rel="noreferrer"
          >
            Open ChatGPT plugins
          </a>
        </>
      ),
    },
    {
      title: "Add a custom MCP server",
      body: (
        <p>
          Select <b>Add</b> at the top right, then <b>Add custom MCP server</b>.
        </p>
      ),
    },
    {
      title: "Fill in the form",
      body: (
        <>
          <p>Leave the icon and description empty.</p>
          <dl className="setup-fields">
            <dt>Name</dt>
            <dd>
              <code>Physix</code>
              <CopyButton text="Physix" label="Copy name" />
            </dd>
            <dt>Server URL</dt>
            <dd>
              <code>{address}</code>
              <CopyButton text={address} label="Copy address" />
            </dd>
            <dt>Authentication</dt>
            <dd>
              <b>No authentication</b>
            </dd>
          </dl>
        </>
      ),
    },
    {
      title: "Create the plugin",
      body: (
        <p>
          Read the warning about custom servers, tick{" "}
          <b>I understand and want to continue</b>, then select{" "}
          <b>Create as plugin</b>.
        </p>
      ),
    },
    {
      title: "Try an experiment",
      body: (
        <>
          <p>
            Start a new chat and paste this prompt. ChatGPT runs the experiment
            with Physix and reports the plotted values and the theory check.
          </p>
          <blockquote className="setup-prompt">{prompt}</blockquote>
          <CopyButton text={prompt} label="Copy example prompt" />
        </>
      ),
    },
  ];
}

export function ChatGPTSetup({
  address,
  prompt,
}: {
  address: string;
  prompt: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const steps = setupSteps(address, prompt);
  const last = step === steps.length - 1;
  const current = steps[step];

  return (
    <>
      <button
        type="button"
        className="pastoral-action pastoral-action--primary"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
      >
        <span>Add Physix to ChatGPT</span>
        <span className="pastoral-keycap">
          <ChevronRight size={9} strokeWidth={2.8} aria-hidden="true" />
        </span>
      </button>
      <Sheet
        open={open}
        title="Add Physix to ChatGPT"
        onClose={() => setOpen(false)}
      >
        <div className="setup-step">
          <p className="setup-count" aria-live="polite">
            Step {step + 1} of {steps.length}
          </p>
          <ol className="setup-progress" aria-hidden="true">
            {steps.map(({ title }, index) => (
              <li key={title} data-done={index <= step ? "" : undefined} />
            ))}
          </ol>
          <h3>{current.title}</h3>
          {current.body}
        </div>
        <footer className="setup-nav">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (last ? setOpen(false) : setStep(step + 1))}
          >
            {last ? "Done" : "Next"}
          </button>
        </footer>
      </Sheet>
    </>
  );
}
