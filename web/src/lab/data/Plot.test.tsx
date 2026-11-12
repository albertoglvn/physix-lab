import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { niceTicks, Plot, valueRange } from "./Plot";

describe("plot scales", () => {
  it("places ticks 1, 2 or 5 × 10ⁿ apart", () => {
    expect(niceTicks(0, 1).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 1).digits).toBe(1);
    expect(niceTicks(-3, 7, 5).ticks).toEqual([-2, 0, 2, 4, 6]);
    expect(niceTicks(0, 2.083, 5).ticks).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(niceTicks(120, 480, 4).digits).toBe(0);
    expect(niceTicks(5, 5).ticks).toEqual([5]);
  });

  it("pads the value range and widens a flat one", () => {
    expect(valueRange([0, 10])).toEqual([-0.6, 10.6]);
    expect(valueRange([2, 2, Number.NaN])).toEqual([1.5, 2.5]);
    expect(valueRange([])).toEqual([0, 1]);
  });
});

describe("plot", () => {
  const series = {
    label: "Speed",
    symbol: "v",
    unit: "m/s",
    color: "var(--px-series-1)",
    t: [0, 0.5, 1, 1.5, 2],
    values: [0, 1, 2, 3, 4],
  };

  it("titles both axes with units and reveals samples up to the live time", () => {
    const html = renderToStaticMarkup(
      <Plot series={series} domain={2} until={1} />,
    );
    expect(html).toContain("Time (s)");
    expect(html).toContain("Speed (m/s)");
    expect(html).toContain('aria-label="Speed against time"');
    const path = html.match(/class="lab-plot-line" d="([^"]+)"/)?.[1] ?? "";
    expect(path.match(/[ML]/g)).toHaveLength(3);
    expect(html).not.toContain("lab-plot-ref");
  });

  it("draws the theory curve dashed and keys it", () => {
    const html = renderToStaticMarkup(
      <Plot
        series={series}
        curve={{ at: (t) => 2 * t, until: 2 }}
        domain={2}
        until={0}
      />,
    );
    expect(html).toContain("lab-plot-ref");
    expect(html).toContain("Theory");
    const path = html.match(/class="lab-plot-line" d="([^"]+)"/)?.[1] ?? "";
    expect(path).not.toContain("L");
  });
});
