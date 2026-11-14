import { useState, type PointerEvent } from "react";
import {
  formatValue,
  MARGIN,
  niceTicks,
  PlotAxes,
  useWidth,
  valueRange,
  type PlotAxis,
} from "./Plot";

/** One swept value: its clean result, any synthetic readings and the closed form. */
export type ScatterPoint = {
  x: number;
  value: number;
  readings: number[];
  theory?: number;
};

/** A fitted curve and the half-width of its band (coverage × standard error) at x. */
export type ScatterFit = {
  at: (x: number) => number;
  band: (x: number) => number;
  label: string;
};

/** One slice of a grid sweep: the points at one value of the second variable. */
export type ScatterGroup = {
  label: string;
  color: string;
  points: ScatterPoint[];
};

export type SweepPlotProps = {
  points: ScatterPoint[];
  /**
   * Slices of a grid, each in its own colour and joined by a line; when given, they replace
   * `points` and `color`, and no fit is drawn.
   */
  groups?: ScatterGroup[];
  xAxis: PlotAxis;
  yAxis: PlotAxis;
  /** The swept range, so the frame holds still while points stream in. */
  domain: [number, number];
  /** A CSS colour reference, such as `var(--px-series-1)`. */
  color: string;
  fit?: ScatterFit;
  height?: number;
};

const FIT_SAMPLES = 120;
const MARKER = 3.25;

/** The x range padded so markers at the ends clear the frame. */
export function xRange([from, to]: [number, number]): [number, number] {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const pad =
    high - low > 1e-12
      ? (high - low) * 0.04
      : Math.max(Math.abs(high) * 0.1, 0.5);
  return [low - pad, high + pad];
}

/**
 * A sweep plot (DESIGN.md §6, Sweep plot): the metric against the swept variable. Simulated
 * values are filled markers, synthetic readings hollow ones, the closed form a dashed line,
 * and a fit a solid line over its ±2 SE band at 16 % of the series colour.
 */
export function SweepPlot({
  points: single,
  groups,
  xAxis,
  yAxis,
  domain,
  color,
  fit: singleFit,
  height = 200,
}: SweepPlotProps) {
  const sets = groups ?? [{ label: "Simulated", color, points: single }];
  const points = sets.flatMap((set) => set.points);
  const fit = groups ? undefined : singleFit;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const width = useWidth(node, 520);
  const [hover, setHover] = useState<number | null>(null);
  const [left, right] = xRange(domain);
  const fitXs = fit
    ? Array.from(
        { length: FIT_SAMPLES + 1 },
        (_, index) =>
          domain[0] + ((domain[1] - domain[0]) * index) / FIT_SAMPLES,
      )
    : [];
  const fitValues = fitXs.map((x) => fit!.at(x));
  const bands = fitXs.map((x) => fit!.band(x));
  const [low, high] = valueRange([
    ...points.flatMap((point) => [
      point.value,
      ...point.readings,
      point.theory ?? Number.NaN,
    ]),
    ...fitValues,
  ]);
  const inner = {
    width: width - MARGIN.left - MARGIN.right,
    height: height - MARGIN.top - MARGIN.bottom,
  };
  const x = (value: number) =>
    MARGIN.left + ((value - left) / (right - left)) * inner.width;
  const y = (value: number) =>
    MARGIN.top + ((high - value) / (high - low)) * inner.height;
  const clampY = (value: number) =>
    Math.min(Math.max(y(value), MARGIN.top), height - MARGIN.bottom);
  const xScale = niceTicks(
    left,
    right,
    Math.max(2, Math.round(inner.width / 90)),
  );
  const yScale = niceTicks(low, high, 4);

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const line = (
    items: ScatterPoint[],
    value: (point: ScatterPoint) => number,
  ) =>
    [...items]
      .sort((a, b) => a.x - b.x)
      .filter((point) => Number.isFinite(value(point)))
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.x).toFixed(1)} ${y(value(point)).toFixed(1)}`,
      )
      .join("");
  const theories = sets.map((set) =>
    line(set.points, (point) => point.theory ?? Number.NaN),
  );
  const theory = theories.some(Boolean);
  const slices = groups
    ? sets.map((set) => line(set.points, (point) => point.value))
    : [];
  const finite = fitXs.flatMap((at, index) =>
    Number.isFinite(fitValues[index]) ? [index] : [],
  );
  const fitPath = finite
    .map(
      (index, order) =>
        `${order ? "L" : "M"}${x(fitXs[index]).toFixed(1)} ${clampY(fitValues[index]).toFixed(1)}`,
    )
    .join("");
  const bandPath = finite.length
    ? [
        ...finite.map(
          (index, order) =>
            `${order ? "L" : "M"}${x(fitXs[index]).toFixed(1)} ${clampY(fitValues[index] + (bands[index] || 0)).toFixed(1)}`,
        ),
        ...[...finite]
          .reverse()
          .map(
            (index) =>
              `L${x(fitXs[index]).toFixed(1)} ${clampY(fitValues[index] - (bands[index] || 0)).toFixed(1)}`,
          ),
        "Z",
      ].join("")
    : "";
  const synthetic = points.some((point) => point.readings.length);
  const hovered =
    hover === null || !sorted.length
      ? undefined
      : sorted.reduce((best, point) =>
          Math.abs(point.x - hover) < Math.abs(best.x - hover) ? point : best,
        );

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const at =
      left +
      ((event.clientX - box.left - MARGIN.left) / inner.width) * (right - left);
    setHover(at >= left && at <= right ? at : null);
  }

  const readout = (point: ScatterPoint) => {
    if (groups)
      return [
        `${xAxis.symbol} ${formatValue(point.x)} ${xAxis.unit}`,
        ...sets.flatMap((set) => {
          const match = set.points.find((item) => item.x === point.x);
          return match
            ? [`${set.label}: ${formatValue(match.value)} ${yAxis.unit}`]
            : [];
        }),
      ].join(" · ");
    const parts = [
      `${xAxis.symbol} ${formatValue(point.x)} ${xAxis.unit}`,
      `${yAxis.symbol} ${formatValue(point.value)} ${yAxis.unit}`,
    ];
    if (point.theory !== undefined)
      parts.push(`Theory ${formatValue(point.theory)}`);
    if (point.readings.length)
      parts.push(
        `${point.readings.length} readings, mean ${formatValue(
          point.readings.reduce((sum, value) => sum + value, 0) /
            point.readings.length,
        )}`,
      );
    if (fit) parts.push(`Fit ${formatValue(fit.at(point.x))}`);
    return parts.join(" · ");
  };

  return (
    <figure className="lab-plot" ref={setNode}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yAxis.label} against ${xAxis.label.toLowerCase()}, ${points.length} points${groups ? ` in ${groups.length} slices` : ""}${synthetic ? " with synthetic readings" : ""}${theory ? ", with the closed form" : ""}${fit ? `, with the ${fit.label} fit` : ""}`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <PlotAxes
          width={width}
          height={height}
          x={x}
          y={y}
          xScale={xScale}
          yScale={yScale}
          xTitle={`${xAxis.label}${xAxis.unit ? ` (${xAxis.unit})` : ""}`}
          yTitle={`${yAxis.label}${yAxis.unit ? ` (${yAxis.unit})` : ""}`}
        />
        {bandPath ? (
          <path
            className="lab-plot-band"
            d={bandPath}
            style={{ fill: color }}
          />
        ) : null}
        {theories.map((path, index) =>
          path ? <path key={index} className="lab-plot-ref" d={path} /> : null,
        )}
        {fitPath ? (
          <path
            className="lab-plot-line"
            d={fitPath}
            style={{ stroke: color }}
          />
        ) : null}
        {slices.map((path, index) =>
          path ? (
            <path
              key={index}
              className="lab-plot-line lab-plot-line--overlay"
              d={path}
              style={{ stroke: sets[index].color }}
            />
          ) : null,
        )}
        {sets.map((set, index) => (
          <g
            key={index}
            className="lab-plot-readings"
            style={{ stroke: set.color }}
          >
            {set.points.flatMap((point) =>
              point.readings.map((reading, repeat) => (
                <circle
                  key={`${point.x}:${repeat}`}
                  cx={x(point.x)}
                  cy={y(reading)}
                  r={MARKER}
                />
              )),
            )}
          </g>
        ))}
        {sets.map((set, index) => (
          <g
            key={index}
            className="lab-plot-points"
            style={{ fill: set.color }}
          >
            {set.points.map((point) =>
              Number.isFinite(point.value) ? (
                <circle
                  key={point.x}
                  cx={x(point.x)}
                  cy={y(point.value)}
                  r={synthetic ? MARKER - 1.25 : MARKER}
                />
              ) : null,
            )}
          </g>
        ))}
        {hovered ? (
          <g className="lab-plot-cursor">
            <line
              x1={x(hovered.x)}
              x2={x(hovered.x)}
              y1={MARGIN.top}
              y2={height - MARGIN.bottom}
            />
          </g>
        ) : null}
      </svg>
      <figcaption className="lab-plot-key">
        {hovered ? (
          <span className="num">{readout(hovered)}</span>
        ) : (
          <>
            {sets.map((set, index) => (
              <span key={index}>
                <i
                  className="lab-plot-marker"
                  style={{ background: set.color }}
                  aria-hidden="true"
                />
                {set.label}
              </span>
            ))}
            {synthetic ? (
              <span>
                <i
                  className="lab-plot-marker lab-plot-marker--hollow"
                  style={{ borderColor: sets[0].color }}
                  aria-hidden="true"
                />
                Synthetic readings
              </span>
            ) : null}
            {theory ? (
              <span>
                <i
                  className="lab-plot-swatch lab-plot-swatch--ref"
                  aria-hidden="true"
                />
                Theory
              </span>
            ) : null}
            {fit ? (
              <span>
                <i
                  className="lab-plot-swatch lab-plot-swatch--band"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                {fit.label}
              </span>
            ) : null}
          </>
        )}
      </figcaption>
    </figure>
  );
}
