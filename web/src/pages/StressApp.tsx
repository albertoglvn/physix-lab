import { ModelCard } from "./ModelCard";
import { Landing } from "./Landing";
import { Studio } from "./Studio";
import { useEngine, useHealth } from "../state";
import { WorkspaceHeader } from "../ui/pastoral";
import "./stress.css";

const sections = [
  { href: "#/stress", page: "overview", label: "Overview" },
  { href: "#/studio", page: "studio", label: "Stress studio" },
  { href: "#/model", page: "model", label: "Model card" },
] as const;

function EnginePill() {
  const e = useEngine();
  const text =
    e.status === "ready"
      ? `Ensemble ready · ${e.engine.manifest.members.length} models`
      : e.status === "error"
        ? "Model bundle unavailable"
        : `Loading models ${Math.round(e.progress * 100)}%`;
  return (
    <span
      className={`pill ${e.status === "ready" ? "is-on" : e.status === "error" ? "is-bad" : "is-wait"}`}
      title={e.error ?? "Stress prediction runs in this tab"}
    >
      <span className="pill-dot" />
      {text}
    </span>
  );
}

export function StressApp({ route }: { route: string }) {
  const health = useHealth();
  const [, section, example, panel] = route.split("/");
  const page =
    section === "studio"
      ? "studio"
      : section === "model"
        ? "model"
        : "overview";
  const solver = health.online
    ? health.source === "browser"
      ? "Browser FEM available"
      : "FEM solver online"
    : health.checked
      ? "FEM unavailable"
      : "Checking FEM solver";

  return (
    <div className={`pastoral stress-shell page-${page}`}>
      <WorkspaceHeader current="stress" />
      <div className="stress-navigation">
        <nav aria-label="Stress tools">
          {sections.map((item) => (
            <a
              href={item.href}
              key={item.href}
              aria-current={item.page === page ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="stress-status">
          <EnginePill />
          <span
            className={`pill ${health.online ? "is-on" : health.checked ? "is-off" : "is-wait"}`}
            title={health.solver ?? undefined}
          >
            <span className="pill-dot" />
            {solver}
          </span>
        </div>
      </div>
      <main className="content">
        {page === "studio" ? (
          <Studio
            key={route}
            health={health}
            example={example === "bracket" ? "bracket" : "plate"}
            initialPanel={panel === "optimize" ? "optimize" : "verify"}
          />
        ) : page === "model" ? (
          <ModelCard health={health} />
        ) : (
          <Landing health={health} />
        )}
      </main>
    </div>
  );
}
