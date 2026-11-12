/** Application shell: header, status pills and hash routes. */

import { ModelCard } from "./pages/ModelCard";
import { Landing } from "./pages/Landing";
import { Studio } from "./pages/Studio";
import { useEngine, useHealth, useRoute } from "./state";
import { Logo } from "./ui/controls";

const NAV = [
  { href: "#/", route: "/", label: "Overview" },
  { href: "#/studio", route: "/studio", label: "Studio" },
  { href: "#/model", route: "/model", label: "Model card" },
];

function EnginePill() {
  const e = useEngine();
  const text =
    e.status === "ready"
      ? `Ensemble ready · ${e.engine.manifest.members.length} models`
      : e.status === "error"
        ? "No model bundle"
        : `Loading models ${Math.round(e.progress * 100)}%`;
  const tone =
    e.status === "ready"
      ? "is-on"
      : e.status === "error"
        ? "is-bad"
        : "is-wait";
  return (
    <span
      className={`pill ${tone}`}
      title={
        e.status === "error" ? e.error : "Runs in this tab with WebAssembly"
      }
    >
      <span className="pill-dot" />
      {text}
    </span>
  );
}

export function App() {
  const route = useRoute();
  const health = useHealth();
  const page = route.startsWith("/studio")
    ? "studio"
    : route.startsWith("/model")
      ? "model"
      : "home";

  return (
    <div className={`app page-${page}`}>
      <header className="topbar">
        <a className="brand" href="#/">
          <Logo />
          <span>Physix</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={
                (n.route === "/" ? page === "home" : route.startsWith(n.route))
                  ? "is-active"
                  : ""
              }
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="topbar-status">
          <EnginePill />
          <span
            className={`pill ${health.online ? "is-on" : health.checked ? "is-off" : "is-wait"}`}
            title={
              health.online
                ? `Local API at 127.0.0.1:8765 · ${health.solver}`
                : "Start it with make serve"
            }
          >
            <span className="pill-dot" />
            {health.online ? "FEM solver online" : "FEM solver offline"}
          </span>
        </div>
      </header>
      <main className="content">
        {page === "studio" ? (
          <Studio health={health} />
        ) : page === "model" ? (
          <ModelCard health={health} />
        ) : (
          <Landing health={health} />
        )}
      </main>
    </div>
  );
}
