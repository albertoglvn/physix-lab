import { useEffect, useState } from "react";
import { Action, PhysixMark } from "../ui/pastoral";
import { ChatGPTConnect } from "./ChatGPTConnect";
import { StressSampler } from "../ui/StressSampler";
import { presetNames, type Preset } from "../lab/scene";
import apparatus from "../assets/studio/halftone-1920.webp";
import apparatusCompact from "../assets/studio/halftone-1040.webp";
import incline from "../assets/studio/incline.webp";
import friction from "../assets/studio/friction.webp";
import pulley from "../assets/studio/pulley.webp";
import "./home.css";

const chapters = [
  {
    name: "Build",
    text: "Add a block, ball, ramp, spring, pendulum or pulley. Drag its arrows to place it, then set its starting conditions.",
    caption: "Parts and initial conditions",
  },
  {
    name: "Run",
    text: "Run the scene or step through it. When a block reaches the floor, continue the run to see what it hits next.",
    caption: "Motion and interactions",
  },
  {
    name: "Measure",
    text: "Read the plot as the experiment runs and compare it with the theory value. Export Scene JSON to share the setup or ask your agent to change it.",
    caption: "Motion over time",
  },
];

// Every "Connect your agent" button scrolls to the connect section, which offers the open
// MCP address to any agent and ChatGPT sign-in to accounts with plugin access.
const connectHref = "#/connect";

const experiments = [
  {
    id: "incline",
    title: "When does a block slide?",
    subject: "Inclined plane",
    image: incline,
  },
  {
    id: "friction",
    title: "How far will a block travel?",
    subject: "Friction track",
    image: friction,
  },
  {
    id: "pulley",
    title: "What makes a pulley move?",
    subject: "Atwood machine",
    image: pulley,
  },
];

// Templates beyond the three illustrated cards, in the order a course meets them.
const moreTemplates: Preset[] = [
  "springPulley",
  "bumper",
  "collision",
  "pendulum",
  "spring",
  "projectile",
  "rolling",
  "bounce",
  "drag",
];

function Schematic({ step }: { step: number }) {
  return (
    <svg
      className="home-diagram"
      viewBox="0 0 540 306"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="schematic-grid"
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M20 0H0V20"
            fill="none"
            style={{ stroke: "var(--px-home-schematic-grid)" }}
          />
        </pattern>
      </defs>
      <path d="M40 33h460v240H40z" fill="url(#schematic-grid)" opacity=".72" />
      <g style={{ stroke: "var(--px-home-schematic-ink)" }} strokeWidth="1.15">
        {step === 0 ? (
          <>
            <circle cx="270" cy="153" r="91" strokeDasharray="2 6" />
            <circle
              cx="270"
              cy="153"
              r="64"
              strokeDasharray="2 5"
              opacity=".6"
            />
            <path d="M258 153h24m-12-12v24M141 183h25v25h-25zM182 89h30v30h-30zM351 194h18v18h-18zM368 98h22v22h-22zM264 57h12v12h-12z" />
            <path
              d="M115 239h310M116 239V62"
              strokeDasharray="3 5"
              opacity=".52"
            />
          </>
        ) : step === 1 ? (
          <>
            <ellipse
              cx="270"
              cy="153"
              rx="151"
              ry="58"
              transform="rotate(-19 270 153)"
              strokeDasharray="3 5"
            />
            <path d="M149 211h248l-153-81z" />
            <path d="m257 138 15-28 29 15-15 28zM314 121l31 16m-8-12 8 12-14 1M287 163v26m-5-8 5 8 5-8" />
            <circle cx="270" cy="153" r="86" opacity=".44" />
          </>
        ) : (
          <>
            <path
              d="M129 73v145h292M129 182h292m-292-36h292m-292-36h292"
              strokeDasharray="3 5"
              opacity=".62"
            />
            <path d="m151 195 44-12 44-21 44-14 44-28 44-23 42-25" />
            {[
              [151, 195],
              [195, 183],
              [239, 162],
              [283, 148],
              [327, 120],
              [371, 97],
              [413, 72],
            ].map(([x, y]) => (
              <circle
                key={x}
                cx={x}
                cy={y}
                r="5"
                style={{ fill: "var(--px-daylight)" }}
              />
            ))}
          </>
        )}
      </g>
    </svg>
  );
}

export function Home({ route }: { route: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (
      route !== "/connect" &&
      route !== "/experiments" &&
      route !== "/how-it-works" &&
      route !== "/stress-tools"
    )
      return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(route.slice(1))?.scrollIntoView(),
    );
    return () => cancelAnimationFrame(frame);
  }, [route]);

  return (
    <div className="pastoral home">
      <header className="home-nav">
        <a href="#/" className="home-nav-mark" aria-label="Physix home">
          <PhysixMark />
          <span>Physix</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#/how-it-works">How it works</a>
          <a href="#/experiments">Experiments</a>
          <a href="#/stress-tools">Stress tools</a>
        </nav>
        <Action href={connectHref}>Connect your agent</Action>
      </header>

      <main>
        <section className="home-hero" aria-labelledby="home-title">
          <picture className="home-hero-art" aria-hidden="true">
            <source media="(max-width: 860px)" srcSet={apparatusCompact} />
            <img
              src={apparatus}
              alt=""
              width={1920}
              height={640}
              fetchPriority="high"
            />
          </picture>
          <div className="home-hero-panel">
            <h1 id="home-title">A physics lab for your agent.</h1>
            <p>
              Connect Physix to ChatGPT or another AI agent to run mechanics
              experiments and compare stress in plates and brackets. Open the
              browser lab to build and run 3D experiments yourself.
            </p>
            <div className="home-hero-actions">
              <Action href={connectHref}>Connect your agent</Action>
              <Action href="#/lab" variant="text">
                Open the lab
              </Action>
            </div>
          </div>
        </section>

        <ChatGPTConnect />

        <section
          className="home-method home-editorial"
          id="how-it-works"
          aria-labelledby="method-title"
        >
          <h2 id="method-title">
            Build a scene. <em>Run the experiment.</em>
          </h2>
          <div className="home-method-layout">
            <div>
              <div className="home-method-tabs" aria-label="Experiment steps">
                {chapters.map((chapter, i) => (
                  <button
                    key={chapter.name}
                    type="button"
                    aria-pressed={step === i}
                    onClick={() => setStep(i)}
                  >
                    {chapter.name}
                  </button>
                ))}
              </div>
              <p className="home-method-description">{chapters[step].text}</p>
            </div>
            <figure>
              <div className="home-diagram-tray">
                <Schematic step={step} />
              </div>
              <figcaption>{chapters[step].caption}</figcaption>
            </figure>
          </div>
        </section>

        <section
          className="home-experiments"
          id="experiments"
          aria-labelledby="experiments-title"
        >
          <div className="home-section-heading">
            <h2 id="experiments-title">Start with a mechanics experiment</h2>
            <Action href="#/lab?study=motion&template=blank" variant="text">
              Open a blank scene
            </Action>
          </div>
          <div className="home-experiment-grid">
            {experiments.map((experiment) => (
              <a
                key={experiment.id}
                className="home-experiment"
                href={`#/lab?study=motion&template=${experiment.id}`}
              >
                <img
                  src={experiment.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={600}
                  height={600}
                />
                <span className="home-experiment-caption">
                  <strong>{experiment.title}</strong>
                  <span>{experiment.subject}</span>
                </span>
              </a>
            ))}
          </div>
          <nav className="home-template-list" aria-label="More templates">
            <span>More setups</span>
            {moreTemplates.map((id) => (
              <a key={id} href={`#/lab?study=motion&template=${id}`}>
                {presetNames[id]}
              </a>
            ))}
          </nav>
        </section>
        <StressSampler />
      </main>

      <footer className="home-footer">
        <div className="home-footer-intro">
          <h2>Bring a mechanics problem to your agent</h2>
          <p>
            Export a template from Scene JSON. Ask your agent to edit the{" "}
            <code>physix.lab/2</code> file, then load it to run the new setup.
          </p>
          <Action href="#/lab?study=motion&template=blank" variant="text">
            Open the mechanics lab
          </Action>
        </div>
        <div className="home-utilities">
          <a className="home-footer-wordmark" href="#/">
            <PhysixMark />
            <span>Physix</span>
          </a>
          <nav aria-label="Footer navigation">
            <a href="#/experiments">Experiments</a>
            <a href="#/stress-tools">Stress tools</a>
            <a href="#/lab?study=stress&sheet=model">Model card</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
