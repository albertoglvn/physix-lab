import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConvergenceResponse } from "../../api/client";
import { examplePlate } from "../../physics/case";
import fixture from "../../../../tests/fixtures/convergence_v1.json";
import {
  CONVERGENCE_CSV_COLUMNS,
  convergenceCsv,
  convergenceMethods,
  promotedLevel,
  studyProbes,
} from "./convergence";
import {
  ConvergenceSheet,
  hotspotPlot,
  referencePreset,
  type ConvergenceRun,
  type ConvergenceState,
} from "./ConvergenceSheet";

/** The service envelope around the shared study fixture (physix.convergence/1). */
const study = {
  schema: "physix.convergence/1",
  source: "fem",
  case_id: "fixture",
  solver: fixture.solver,
  presets: fixture.presets,
  ...fixture.study,
  hotspot_rule:
    "maximum von Mises outside the support exclusion band, mesh basis",
  timing: { total_ms: 3800, boundary: "three server-side solves" },
} as ConvergenceResponse;

const NET_SECTION = {
  a: [0.1, 0] as [number, number],
  b: [0.1, 0.08] as [number, number],
};

function state(run: ConvergenceRun | null): ConvergenceState {
  return {
    run,
    busy: false,
    error: null,
    start: async () => {},
    cancel: () => {},
    adopt: () => {},
  };
}

describe("convergence study helpers", () => {
  it("drops probes in the hole or near a boundary", () => {
    const c = examplePlate();
    expect(studyProbes(c, NET_SECTION)).toEqual([
      { x: 0.1, y: 0.02 },
      { x: 0.1, y: 0.06 },
    ]);
    // Along the top edge every point is on the boundary.
    expect(studyProbes(c, { a: [0, 0.08], b: [0.2, 0.08] })).toEqual([]);
  });

  it("matches the probes the fixture was solved with", () => {
    expect(studyProbes(examplePlate(), NET_SECTION)).toEqual(
      study.probes.map(({ x, y }) => ({ x, y })),
    );
    expect(fixture.case).toEqual(examplePlate());
  });

  it("promotes the finest passing level", () => {
    expect(study.promoted).toBe("fine");
    expect(promotedLevel(study)?.elements).toBe(study.levels[2].elements);
    expect(promotedLevel({ ...study, promoted: null })).toBeUndefined();
  });

  it("writes methods text with the order cap, limit and GCI", () => {
    const text = convergenceMethods(study);
    expect(text).toContain("scikit-fem");
    expect(text).toContain("three levels: coarse (1022 elements");
    expect(text).toContain("capped at the formal order 2");
    expect(text).toContain("Richardson extrapolation gave 33.91 MPa");
    expect(text).toContain("fine mesh was the finest level within tolerance");
    const divergent = convergenceMethods({
      ...study,
      hotspot: { ...study.hotspot, kind: "divergent", extrapolated: null },
      promoted: null,
    });
    expect(divergent).toContain("not decreasing, so no extrapolation");
    expect(divergent).toContain("No level met the tolerances");
  });

  it("exports levels in SI units with the fit and the probes", () => {
    const lines = convergenceCsv(study).trimEnd().split("\n");
    expect(lines[0]).toBe("# physix.convergence/1 fixture");
    const header = lines.indexOf(CONVERGENCE_CSV_COLUMNS.join(","));
    const rows = lines.slice(header + 1, header + 4).map((l) => l.split(","));
    expect(rows.map((r) => r[0])).toEqual(["fast", "reference", "fine"]);
    expect(Number(rows[0][4])).toBeCloseTo(study.levels[0].hotspot.von_mises);
    expect(rows[2][5]).toBe("");
    expect(lines.filter((l) => l.startsWith("# probe"))).toHaveLength(2);
    expect(lines.join("\n")).toContain("# promoted: fine");
  });

  it("plots the levels, the Richardson limit and the GCI band", () => {
    const plot = hotspotPlot(study);
    expect(plot.marks.map((m) => m.x)).toEqual(
      study.levels.map((l) => l.element_size * 1e3),
    );
    expect(plot.lines).toHaveLength(2);
    expect(plot.lines[1].dashed).toBe(true);
    expect(plot.lines[1].points[0]).toEqual([
      0,
      study.hotspot.extrapolated! / 1e6,
    ]);
    const fine = study.levels[2].hotspot.von_mises / 1e6;
    expect(plot.band.high - plot.band.low).toBeCloseTo(
      2 * fine * study.hotspot.gci_fine,
    );
    const noLimit = hotspotPlot({
      ...study,
      hotspot: { ...study.hotspot, extrapolated: null },
    });
    expect(noLimit.lines).toHaveLength(1);
  });

  it("uses the promoted mesh only while adopted and for the same part", () => {
    const c = examplePlate();
    const run = { forCase: JSON.stringify(c), data: study, adopted: true };
    expect(referencePreset(run, c)).toBe("fine");
    expect(referencePreset({ ...run, adopted: false }, c)).toBeUndefined();
    const moved = {
      ...c,
      geometry: { ...c.geometry, holes: [{ x: 0.09, y: 0.04, radius: 0.012 }] },
    };
    expect(referencePreset(run, moved)).toBeUndefined();
    expect(referencePreset(null, c)).toBeUndefined();
  });
});

describe("ConvergenceSheet", () => {
  const c = examplePlate();
  const probes = studyProbes(c, NET_SECTION);

  it("renders the study with sources, levels and the adopt toggle", () => {
    const html = renderToStaticMarkup(
      <ConvergenceSheet
        c={c}
        state={state({
          forCase: JSON.stringify(c),
          data: study,
          adopted: true,
        })}
        probes={probes}
        probeLabel="net section probe"
        online
        onExport={() => {}}
      />,
    );
    expect(html).toContain("Monotonic convergence");
    expect(html).toContain("Probes: 2 points along the net section probe.");
    expect(html).toContain("Source: FEM (scikit-fem");
    expect(html).toContain("Use the fine mesh for FEM checks of this part");
    expect(html.match(/<tr>/g)).toHaveLength(4);
    expect(html).toContain("GCI band on the fine value");
  });

  it("warns when the part changed and disables the run offline", () => {
    const moved = { ...c, thickness: 0.006 };
    const html = renderToStaticMarkup(
      <ConvergenceSheet
        c={moved}
        state={state({
          forCase: JSON.stringify(c),
          data: study,
          adopted: true,
        })}
        probes={[]}
        probeLabel="drawn line"
        online={false}
        onExport={() => {}}
      />,
    );
    expect(html).toContain("The part changed since this study");
    expect(html).not.toContain("Use the fine mesh");
    expect(html).toContain("No probe points");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*title="The FEM solver is unavailable"/,
    );
  });
});
