import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { examplePlate } from "../../physics/case";
import type { StressPoint } from "./stressSweep";
import {
  reconcileStressForm,
  StressSweepSheet,
  type StressSweepRun,
  type StressSweepState,
} from "./StressSweepSheet";

const RADIUS = "geometry.holes[0].radius";

const surrogate = {
  hotspot: 120e6,
  x: 0.1,
  y: 0.052,
  disagreement: 0.04,
  accepted: true,
  reason: null,
  ms: 7,
};
const fem = {
  hotspot: 100e6,
  x: 0.1,
  y: 0.052,
  basis: "raster" as const,
  preset: "reference",
  nodes: 3900,
  ms: 850,
};

const POINTS: StressPoint[] = [
  { index: 0, x: 0.01, surrogate, source: "surrogate", value: 120e6 },
  {
    index: 1,
    x: 0.012,
    surrogate: { ...surrogate, accepted: false, reason: "high_disagreement" },
    fem,
    source: "fem_fallback",
    value: 100e6,
    reason: "high_disagreement",
    note: "Solved with FEM: the ensemble members disagree.",
  },
  {
    index: 2,
    x: 0.014,
    source: null,
    value: Number.NaN,
    note: "Needs FEM (outside the training domain), but the solver is offline.",
  },
];

function state(run: StressSweepRun | null): StressSweepState {
  return {
    form: undefined,
    setForm: () => {},
    run,
    start: async () => {},
    cancel: () => {},
    confirm: async () => {},
    checking: null,
  };
}

function render(run: StressSweepRun | null, online = true, c = examplePlate()) {
  return renderToStaticMarkup(
    <StressSweepSheet
      c={c}
      state={state(run)}
      deps={{ predict: null, solve: online ? async () => ({}) as never : null }}
      modelReady={false}
      online={online}
      onExport={() => {}}
    />,
  );
}

describe("StressSweepSheet", () => {
  const c = examplePlate();
  const run: StressSweepRun = {
    forCase: JSON.stringify(c),
    base: c,
    spec: { variable: RADIUS, values: [0.01, 0.012, 0.014] },
    points: POINTS,
    status: "done",
  };

  it("starts from the first variable's suggested range", () => {
    expect(reconcileStressForm(c, undefined)).toEqual({
      variable: RADIUS,
      from: "7.2",
      to: "16.8",
      count: "9",
    });
  });

  it("shows each point's source, the counts and the surrogate error", () => {
    const html = render(run);
    expect(html).toContain(
      "3 points. 1 surrogate · 1 FEM fallback · 0 FEM · 1 without a value · surrogate vs FEM hotspot error up to",
    );
    expect(html).toContain(">Surrogate</span>");
    expect(html).toContain(">FEM fallback</span>");
    expect(html).toContain(">No value</span>");
    expect(html).toContain("the ensemble members disagree");
    expect(html).toContain("The model is not loaded");
    // Only the screened point offers an FEM check.
    expect(html.match(/lab-stress-check/g)).toHaveLength(1);
  });

  it("notes an offline solver and a stale part", () => {
    const html = render(run, false, { ...c, thickness: 0.006 });
    expect(html).toContain("The solver is offline");
    expect(html).toContain("The part changed since this sweep");
    expect(html).toMatch(/lab-stress-check"[^>]*disabled=""/);
  });

  it("renders the form alone before a run", () => {
    const html = render(null);
    expect(html).toContain("9 points, screened one at a time");
    expect(html).not.toContain("Sweep results");
  });
});
