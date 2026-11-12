/** Product overview with a live in-browser demo and evidence pulled from the model bundle. */

import { useEffect, useMemo, useState } from "react";
import type { SurrogatePrediction } from "../inference/engine";
import type { Case } from "../physics/case";
import { examplePlate, tractionMagnitude } from "../physics/case";
import { solidMask } from "../physics/encoding";
import { useEngine, type Health } from "../state";
import { Badge, CopyButton, Logo, Spinner } from "../ui/controls";
import { Colorbar, FieldView } from "../ui/FieldView";
import { mpa, ms, pct } from "../ui/units";

function demoCase(t: number): Case {
  const c = examplePlate();
  c.geometry.width = 0.24;
  c.geometry.height = 0.1;
  c.geometry.holes = [
    {
      x: 0.12 + 0.045 * Math.sin(t),
      y: 0.05 + 0.017 * Math.sin(1.7 * t),
      radius: 0.013 + 0.004 * Math.sin(0.6 * t + 1),
    },
  ];
  return c;
}

function HeroDemo() {
  const engine = useEngine();
  const [frame, setFrame] = useState<{
    c: Case;
    pred: SurrogatePrediction;
  } | null>(null);

  useEffect(() => {
    const eng = engine.engine;
    if (!eng) return;
    let alive = true;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t0 = performance.now();
    const step = async () => {
      if (!alive) return;
      const c = demoCase(reduced ? 0.6 : (performance.now() - t0) / 1600);
      try {
        const pred = await eng.predict(c);
        if (alive) setFrame({ c, pred });
      } catch {
        return;
      }
      if (alive && !reduced)
        window.setTimeout(() => requestAnimationFrame(() => void step()), 40);
    };
    void step();
    return () => {
      alive = false;
    };
  }, [engine.engine]);

  const c = frame?.c ?? demoCase(0.6);
  const mask = useMemo(() => solidMask(c), [c]);
  // Fixed scale: four times the applied traction covers a hole concentration (Kt ≈ 3).
  const range = { min: 0, max: 4 * tractionMagnitude(c) };

  return (
    <div className="hero-demo card">
      <div className="hero-demo-head">
        <span className="live-dot" /> Live in this tab
        <span className="muted small">
          {frame
            ? `${ms(frame.pred.timing.total_ms)} per field · ${engine.engine?.threads ?? 1} thread${engine.engine?.threads === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>
      <div className="hero-stage">
        {engine.status === "loading" && (
          <div className="stage-overlay">
            <Spinner label="Loading the ensemble…" />
          </div>
        )}
        {engine.status === "error" && (
          <div className="stage-overlay">
            <p className="muted small">
              Model bundle not found. Run the export to enable the live demo.
            </p>
          </div>
        )}
        <FieldView
          c={c}
          values={frame?.pred.result.vonMises ?? null}
          mask={mask}
          range={range}
          colormap="stress"
          formatValue={(v) => mpa(v)}
          markers={
            frame
              ? [
                  {
                    x: frame.pred.result.hotspot.x,
                    y: frame.pred.result.hotspot.y,
                    label: mpa(frame.pred.result.hotspot.von_mises),
                  },
                ]
              : []
          }
          ariaLabel="Animated von Mises field of a plate with a moving hole"
        />
      </div>
      <div className="hero-demo-foot">
        <Colorbar
          range={range}
          colormap="stress"
          label="von Mises"
          format={(v) => mpa(v, 2)}
        />
        {frame && (
          <span className="small">
            disagreement {pct(frame.pred.result.disagreement)} ·{" "}
            {frame.pred.accepted ? (
              <Badge tone="ok">accepted</Badge>
            ) : (
              <Badge tone="warn">would fall back to FEM</Badge>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function Evidence() {
  const engine = useEngine();
  const m = engine.engine?.manifest;
  const test = m?.evaluation?.splits?.test;
  const med = (k: string) => {
    const v = test?.[k];
    return typeof v === "object" && v ? v.median : null;
  };
  const policy = m?.fallback_policy;
  const timing = m?.evaluation?.timing as
    { warm_median_ms?: number } | undefined;
  return (
    <section className="section" id="evidence">
      <div className="section-head">
        <span className="eyebrow">Evidence, not adjectives</span>
        <h2>Every number below comes from the bundle you are running</h2>
        <p className="muted">
          The model card is generated at export time from held-out scikit-fem
          solutions of identical cases. Open it for the full table, the domain
          and the calibration.
        </p>
      </div>
      {!m ? (
        <p className="muted">
          {engine.status === "error"
            ? "No model bundle is installed yet."
            : "Reading the model card…"}
        </p>
      ) : (
        <div className="evidence-grid">
          <div className="evidence">
            <span className="evidence-value">{m.members.length}</span>
            <span className="evidence-label">independently seeded U-Nets</span>
          </div>
          <div className="evidence">
            <span className="evidence-value">{test ? test.cases : "—"}</span>
            <span className="evidence-label">
              held-out test cases solved with FEM
            </span>
          </div>
          <div className="evidence">
            <span className="evidence-value">{pct(med("hotspot_error"))}</span>
            <span className="evidence-label">
              median peak-stress error on test (grid basis)
            </span>
          </div>
          <div className="evidence">
            <span className="evidence-value">
              {pct(policy?.test?.coverage ?? null, 0)}
            </span>
            <span className="evidence-label">
              of test cases answered without FEM at the calibrated threshold
            </span>
          </div>
          <div className="evidence">
            <span className="evidence-value">
              {ms(timing?.warm_median_ms ?? null)}
            </span>
            <span className="evidence-label">
              warm ensemble inference on the export host (CPU)
            </span>
          </div>
          <div className="evidence">
            <span className="evidence-value mono">
              {m.model_id.replace("physix-", "")}
            </span>
            <span className="evidence-label">
              model id, hash-pinned per member
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

const MCP_CONFIG = `{
  "mcpServers": {
    "physix": {
      "command": "uv",
      "args": ["run", "python", "-m", "scripts.run_feature", "physix_mcp.server"]
    }
  }
}`;

export function Landing({ health }: { health: Health }) {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <Badge tone="accent">
            2D linear elasticity · plates and brackets
          </Badge>
          <h1>
            Stress fields in milliseconds.
            <br />
            <span className="grad">Checked against FEM when it matters.</span>
          </h1>
          <p className="lead">
            Physix gives engineering agents and their humans an instant estimate
            of the stress field in a parametric part, states how much to trust
            it, and falls back to a real finite-element solve when the models
            disagree.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary btn-lg" href="#/studio">
              Open the studio
            </a>
            <a className="btn btn-secondary btn-lg" href="#/model">
              Read the model card
            </a>
          </div>
          <ul className="hero-points">
            <li>Five-model ensemble runs locally in the browser, no upload</li>
            <li>Calibrated disagreement decides when to call scikit-fem</li>
            <li>MCP tools for prediction, verification and optimisation</li>
          </ul>
        </div>
        <HeroDemo />
      </section>

      <section className="section" id="how">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>A fast path that knows when to take the slow one</h2>
        </div>
        <ol className="steps">
          <li>
            <span className="step-n">1</span>
            <h3>Describe the part</h3>
            <p>
              A versioned case in SI units: plate or L-bracket, circular holes,
              thickness, material, traction or force.
            </p>
          </li>
          <li>
            <span className="step-n">2</span>
            <h3>Predict with five models</h3>
            <p>
              Each U-Net maps the encoded geometry to unit-load stress fields;
              the mean is the estimate, the spread is the doubt.
            </p>
          </li>
          <li>
            <span className="step-n">3</span>
            <h3>Fall back when unsure</h3>
            <p>
              Out-of-domain cases or disagreement above the calibrated threshold
              go to a quadratic-element scikit-fem solve.
            </p>
          </li>
          <li>
            <span className="step-n">4</span>
            <h3>Learn from every fallback</h3>
            <p>
              Solved cases are stored by case id for the next training round;
              new weights ship only with a new evaluation.
            </p>
          </li>
        </ol>
      </section>

      <Evidence />

      <section className="section split" id="agents">
        <div>
          <span className="eyebrow">Built for agents</span>
          <h2>Four tools, explicit provenance</h2>
          <p className="muted">
            Every answer carries its source (<code>surrogate</code>,{" "}
            <code>fem</code> or <code>fem_fallback</code>), the model and case
            versions, the uncertainty or fallback reason, and timing boundaries.
            Agents never have to guess whether a number came from a network or a
            solver.
          </p>
          <ul className="tool-list">
            <li>
              <code>describe_domain</code> supported families, units, trained
              ranges, out-of-scope physics
            </li>
            <li>
              <code>predict_stress</code> field summary with source, uncertainty
              and fallback
            </li>
            <li>
              <code>verify_with_solver</code> the identical case through FEM,
              with the discrepancy
            </li>
            <li>
              <code>optimize</code> bounded geometry search with FEM-verified
              selection
            </li>
          </ul>
        </div>
        <div className="code-card card">
          <div className="code-head">
            <span className="muted small">MCP client configuration</span>
            <CopyButton text={MCP_CONFIG} />
          </div>
          <pre className="code">{MCP_CONFIG}</pre>
          <div className="code-head">
            <span className="muted small">Local HTTP API</span>
            <span className={`api-dot ${health.online ? "is-on" : ""}`}>
              {health.online ? "online" : "offline"}
            </span>
          </div>
          <pre className="code">{`make serve   # http://127.0.0.1:8765\nPOST /api/predict   POST /api/verify   POST /api/optimize`}</pre>
        </div>
      </section>

      <section className="section" id="scope">
        <div className="section-head">
          <span className="eyebrow">Scope</span>
          <h2>Honest about what it does</h2>
        </div>
        <div className="scope-grid">
          <div className="card scope-card">
            <h3>Supported</h3>
            <ul className="check-list">
              <li>Static, small-strain, isotropic linear elasticity</li>
              <li>Thin constant-thickness parts in plane stress</li>
              <li>
                Rectangular plates and fillet L-brackets with circular holes
              </li>
              <li>Clamped edge, uniform traction or resultant force</li>
              <li>Five metals and PMMA, or a custom E and ν</li>
            </ul>
          </div>
          <div className="card scope-card">
            <h3>Rejected with a validation error</h3>
            <ul className="cross-list">
              <li>3D solids, shells and plate bending</li>
              <li>Dynamics, buckling and contact</li>
              <li>Fracture, plasticity and nonlinear materials</li>
              <li>Large deformation</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-brand">
          <Logo size={18} /> Physix
        </div>
        <span className="muted small">
          Estimates are engineering aids, not certification. The scikit-fem
          solution of the identical case is the reference.
        </span>
      </footer>
    </div>
  );
}
