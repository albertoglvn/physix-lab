import { useState } from "react";
import {
  MARGIN,
  niceTicks,
  PlotAxes,
  useWidth,
  valueRange,
  type PlotAxis,
} from "../data/Plot";
import { xRange } from "../data/SweepPlot";

/** One marker: filled for solver values, hollow for surrogate ones. */
export type StudyMark = {
  x: number;
  y: number;
  color: string;
  hollow?: boolean;
  /** A vertical whisker, such as ±1σ ensemble spread. */
  low?: number;
  high?: number;
};

export type StudyLine = {
  points: [number, number][];
  color: string;
  dashed?: boolean;
};

/** A horizontal band from `x0` to `x1`, such as a GCI band. */
export type StudyBand = {
  x0: number;
  x1: number;
  low: number;
  high: number;
  color: string;
};

export type StudyKey = { label: string; color: string; hollow?: boolean };

export type StudyPlotProps = {
  marks: StudyMark[];
  lines?: StudyLine[];
  band?: StudyBand;
  xAxis: PlotAxis;
  yAxis: PlotAxis;
  domain: [number, number];
  keys: StudyKey[];
  label: string;
  height?: number;
};

const MARKER = 3.5;

/**
 * A scatter for the Stress studies (DESIGN.md §6, Sweep plot): solver values as filled
 * markers, surrogate values hollow with their ensemble whiskers, and optional reference
 * lines and a band.
 */
export function StudyPlot({
  marks,
  lines = [],
  band,
  xAxis,
  yAxis,
  domain,
  keys,
  label,
  height = 220,
}: StudyPlotProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const width = useWidth(node, 520);
  const [left, right] = xRange(domain);
  const [low, high] = valueRange([
    ...marks.flatMap((m) => [m.y, m.low ?? m.y, m.high ?? m.y]),
    ...lines.flatMap((l) => l.points.map((p) => p[1])),
    ...(band ? [band.low, band.high] : []),
  ]);
  const inner = {
    width: width - MARGIN.left - MARGIN.right,
    height: height - MARGIN.top - MARGIN.bottom,
  };
  const x = (value: number) =>
    MARGIN.left + ((value - left) / (right - left)) * inner.width;
  const y = (value: number) =>
    MARGIN.top + ((high - value) / (high - low)) * inner.height;
  const xScale = niceTicks(
    left,
    right,
    Math.max(2, Math.round(inner.width / 90)),
  );
  const yScale = niceTicks(low, high, 4);
  const finite = marks.filter((m) => Number.isFinite(m.y));

  return (
    <figure className="lab-plot" ref={setNode}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
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
        {band ? (
          <rect
            className="lab-plot-band"
            x={Math.min(x(band.x0), x(band.x1))}
            width={Math.abs(x(band.x1) - x(band.x0))}
            y={y(band.high)}
            height={Math.max(y(band.low) - y(band.high), 1)}
            style={{ fill: band.color }}
          />
        ) : null}
        {lines.map((l, index) => (
          <path
            key={index}
            className={l.dashed ? "lab-plot-ref" : "lab-plot-line"}
            d={l.points
              .map(
                ([px, py], k) =>
                  `${k ? "L" : "M"}${x(px).toFixed(1)} ${y(py).toFixed(1)}`,
              )
              .join("")}
            style={{ stroke: l.color }}
          />
        ))}
        <g className="lab-plot-whiskers">
          {finite.map((m, index) =>
            m.low !== undefined && m.high !== undefined ? (
              <line
                key={index}
                x1={x(m.x)}
                x2={x(m.x)}
                y1={y(m.low)}
                y2={y(m.high)}
                style={{ stroke: m.color }}
              />
            ) : null,
          )}
        </g>
        {finite.map((m, index) =>
          m.hollow ? (
            <circle
              key={index}
              className="lab-plot-readings"
              cx={x(m.x)}
              cy={y(m.y)}
              r={MARKER}
              style={{ stroke: m.color, fill: "none" }}
            />
          ) : (
            <circle
              key={index}
              cx={x(m.x)}
              cy={y(m.y)}
              r={MARKER}
              style={{ fill: m.color }}
            />
          ),
        )}
      </svg>
      <figcaption className="lab-plot-key">
        {keys.map((key) => (
          <span key={key.label}>
            <i
              className={`lab-plot-marker${key.hollow ? " lab-plot-marker--hollow" : ""}`}
              style={
                key.hollow
                  ? { borderColor: key.color }
                  : { background: key.color }
              }
              aria-hidden="true"
            />
            {key.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
