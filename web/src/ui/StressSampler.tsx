import { useState } from "react";
import plate from "../assets/stress/plate.png";
import bracket from "../assets/stress/bracket.png";
import { gradientCss } from "./colormap";
import { Action } from "./pastoral";

const samples = {
  plate: {
    name: "Plate in tension",
    note: "A steel plate with a central hole, pulled from its right edge.",
    alt: "The most stressed regions appear directly above and below the circular hole.",
    image: plate,
    peak: "30.9 MPa",
  },
  bracket: {
    name: "Bracket under load",
    note: "An aluminium bracket fixed at the top and loaded at the tip.",
    alt: "Stress concentrates at the inside corner of the L-bracket.",
    image: bracket,
    peak: "160 MPa",
  },
};

type Family = keyof typeof samples;

export function StressSampler() {
  const [family, setFamily] = useState<Family>("plate");
  const sample = samples[family];
  return (
    <section
      className="home-stress home-editorial"
      id="stress-tools"
      aria-labelledby="stress-tools-title"
    >
      <div className="home-stress-copy">
        <h2 id="stress-tools-title">Where does the stress go?</h2>
        <p>
          Change a hole, a material, or a load and see how stress redistributes
          across a plate or bracket. Compare the prediction with a finite
          element solve of the same part.
        </p>
        <div className="home-stress-actions">
          <Action href={`#/studio/${family}`}>Open this case</Action>
          <Action href="#/stress" variant="text">
            Explore stress tools
          </Action>
        </div>
      </div>
      <figure className="home-stress-figure">
        <div className="home-diagram-tray">
          <div className="home-stress-sheet">
            <div className="home-stress-switch" aria-label="Reference cases">
              {(Object.keys(samples) as Family[]).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={family === kind}
                  onClick={() => setFamily(kind)}
                >
                  {samples[kind].name}
                </button>
              ))}
            </div>
            <div className="home-stress-stage">
              <img src={sample.image} alt={sample.alt} loading="lazy" />
            </div>
            <div className="home-stress-scale">
              <span>0 MPa</span>
              <i style={{ background: gradientCss("stress", "to right") }} />
              <span>{sample.peak}</span>
            </div>
          </div>
        </div>
        <figcaption>
          {sample.note} Reference von Mises field from scikit-fem.
        </figcaption>
      </figure>
    </section>
  );
}
