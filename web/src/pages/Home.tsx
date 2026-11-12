import { useEffect, useRef, useState } from "react";
import { Action, PhysixMark } from "../ui/pastoral";
import { StressSampler } from "../ui/StressSampler";
import campus from "../assets/pastoral/campus.webp";
import sunflowers from "../assets/pastoral/sunflowers.webp";
import horizon from "../assets/pastoral/horizon.webp";
import incline from "../assets/pastoral/incline.webp";
import friction from "../assets/pastoral/friction.webp";
import pulley from "../assets/pastoral/pulley.webp";
import specimen from "../assets/pastoral/specimen.svg";
import "./home.css";

const chapters = [
  {
    name: "Build",
    text: "Start with a block, a ramp, or a pulley. Place the parts in 3D and set the starting conditions.",
    caption: "Parts and initial conditions",
  },
  {
    name: "Run",
    text: "Press play or advance one step at a time. Change gravity, friction, or mass to isolate a variable.",
    caption: "Motion and interactions",
  },
  {
    name: "Measure",
    text: "Read the motion as it happens. Export the scene as JSON so a classmate or an agent can run the same setup.",
    caption: "Measurements and a reusable scene",
  },
];

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
  const hero = useRef<HTMLElement>(null);
  const [overHero, setOverHero] = useState(true);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const target = hero.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOverHero(entry.isIntersecting),
      { rootMargin: "-75px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
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
      <header className={`home-nav${overHero ? " is-landscape" : ""}`}>
        <a href="#/" className="home-nav-mark" aria-label="Physix home">
          <PhysixMark />
        </a>
        <nav aria-label="Main navigation">
          <a href="#/how-it-works">How it works</a>
          <a href="#/experiments">Experiments</a>
          <a href="#/stress-tools">Stress tools</a>
        </nav>
        <Action href="#/lab">Open lab</Action>
      </header>

      <main>
        <section className="home-hero" ref={hero} aria-labelledby="home-title">
          <img
            className="home-hero-art"
            src={campus}
            alt=""
            fetchPriority="high"
          />
          <div className="home-hero-identity">
            Physix<span>A physics playground</span>
          </div>
          <div className="home-hero-panel">
            <h1 id="home-title">Put physics to the test.</h1>
            <p>
              Build 3D experiments or explore how plates and brackets respond to
              loads. A browser lab for university physics.
            </p>
            <Action href="#/lab" variant="text">
              Enter the lab
            </Action>
          </div>
        </section>
        <div className="home-stripes home-stripes--dusk" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>

        <section
          className="home-vision home-editorial"
          aria-labelledby="vision-title"
        >
          <img src={specimen} alt="" loading="lazy" />
          <div>
            <p>
              A free afternoon in the lab can change how a topic clicks. Physix
              gives you a bench to come back to, wherever you study.
            </p>
            <h2 id="vision-title">
              Make a prediction.
              <br />
              Then give it a push.
            </h2>
          </div>
        </section>

        <section
          className="home-method home-editorial"
          id="how-it-works"
          aria-labelledby="method-title"
        >
          <h2 id="method-title">
            From a few parts to a <em>repeatable experiment.</em>
          </h2>
          <p>Assemble the apparatus, run it, and read the motion.</p>
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

        <section className="home-invitation" aria-labelledby="invitation-title">
          <img src={sunflowers} alt="" loading="lazy" />
          <div>
            <h2 id="invitation-title">
              What happens if
              <br />
              you change one thing?
            </h2>
            <p>
              Start with a ready-to-run experiment or build your own from an
              empty scene.
            </p>
            <Action href="#/lab?study=motion&template=blank" variant="glass">
              Build an experiment
            </Action>
          </div>
        </section>

        <section
          className="home-experiments"
          id="experiments"
          aria-labelledby="experiments-title"
        >
          <div className="home-section-heading">
            <h2 id="experiments-title">Experiments to try</h2>
            <Action href="#/lab" variant="text">
              Browse in the lab
            </Action>
          </div>
          <div className="home-experiment-grid">
            {experiments.map((experiment) => (
              <a
                key={experiment.id}
                className="home-experiment"
                href={`#/lab?study=motion&template=${experiment.id}`}
              >
                <img src={experiment.image} alt="" loading="lazy" />
                <span className="home-experiment-caption">
                  <strong>{experiment.title}</strong>
                  <span>{experiment.subject}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
        <StressSampler />
      </main>

      <footer className="home-footer">
        <div className="home-footer-intro">
          <PhysixMark />
          <h2>
            Bring a question.
            <br />
            See where it goes.
          </h2>
          <Action href="#/lab" variant="text">
            Open the physics lab
          </Action>
        </div>
        <div className="home-utilities">
          <a className="home-footer-wordmark" href="#/">
            Physix
          </a>
          <nav aria-label="Footer navigation">
            <a href="#/experiments">Experiments</a>
            <a href="#/stress-tools">Stress tools</a>
            <a href="#/lab?study=stress&sheet=model">Model card</a>
          </nav>
        </div>
        <div className="home-stripes home-stripes--mint" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="home-horizon">
          <img src={horizon} alt="" loading="lazy" />
        </div>
      </footer>
    </div>
  );
}
