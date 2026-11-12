/** The current case as an agent would send it: MCP tool call, HTTP request and raw JSON. */

import { useState } from "react";
import type { Case } from "../physics/case";
import { CopyButton, Segmented } from "../ui/controls";

type Tab = "mcp" | "http" | "json";

export function AgentPanel({ c }: { c: Case }) {
  const [tab, setTab] = useState<Tab>("mcp");
  const json = JSON.stringify(c, null, 2);
  const snippets: Record<Tab, string> = {
    mcp: `// Tool: predict_stress (physix MCP server, stdio)\n${JSON.stringify({ case: c, include_field: false }, null, 2)}\n\n// Then, before acting on the number:\n// Tool: verify_with_solver  { "case": <same case> }`,
    http: `curl -s http://127.0.0.1:8765/api/predict \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ case: c })}'`,
    json,
  };
  return (
    <div className="panel-body">
      <div className="panel-intro">
        <p>
          Agents use the same contract through MCP (<code>predict_stress</code>,{" "}
          <code>verify_with_solver</code>, <code>optimize</code>,{" "}
          <code>describe_domain</code>) or the local HTTP API. Every response
          states its source (surrogate, FEM or FEM fallback), model and case
          versions, uncertainty and timing.
        </p>
      </div>
      <div className="code-head">
        <Segmented<Tab>
          label="Snippet"
          value={tab}
          onChange={setTab}
          options={[
            { value: "mcp", label: "MCP tool call" },
            { value: "http", label: "HTTP" },
            { value: "json", label: "Case JSON" },
          ]}
        />
        <CopyButton text={snippets[tab]} />
      </div>
      <pre className="code">{snippets[tab]}</pre>
    </div>
  );
}
