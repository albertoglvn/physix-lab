import { useEffect, useState, type PointerEvent } from "react";

export type PlotSeries = {
  label: string;
  symbol: string;
  unit: string;
  /** A CSS colour reference, such as `var(--px-series-1)`. */
  color: string;
  t: number[];
  values: number[];
};

/** A closed-form curve drawn dashed in the reference colour. */
export type PlotCurve = { at: (t: number) => number; until: number };

/** Sampled reference data (a solver profile, say), drawn dashed like a curve. */
export type PlotReference = { t: number[]; values: number[] };

/** The horizontal axis; time in seconds unless a plot says otherwise. */
export type PlotAxis = { label: string; symbol: string; unit: string };

export const TIME_AXIS: PlotAxis = { label: "Time", symbol: "t", unit: "s" };

export type Scale = { ticks: number[]; digits: number };

/** Round tick positions (1, 2 or 5 × 10ⁿ apart) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min)
    return { ticks: [min], digits: 2 };
  const raw = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((factor) => factor * power >= raw)! * power;
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  // Each tick from its integer index, rounded, so labels and gridlines carry no float drift.
  for (let index = first; index <= last; index++)
    ticks.push(Number((index * step).toFixed(digits + 1)) || 0);
  return { ticks, digits };
}

/** Value range of the data and curve, padded so lines clear the frame. */
export function valueRange(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (high - low < 1e-9) {
    const pad = Math.max(Math.abs(high) * 0.1, 0.5);
    return [low - pad, high + pad];
  }
  const pad = (high - low) * 0.06;
  low -= pad;
  high += pad;
  return [low, high];
}

export function useWidth(node: HTMLElement | null, fallback: number) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.floor(entry.contentRect.width))),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return width;
}

export const MARGIN = { top: 10, right: 14, bottom: 34, left: 56 };
const CURVE_SAMPLES = 96;
export const formatValue = (value: number) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(4))) : "—";

export type PlotProps = {
  series: PlotSeries;
  curve?: PlotCurve;
  reference?: PlotReference;
  /** The horizontal axis runs from 0 to this value. */
  domain: number;
  /** Samples after this value stay hidden, so the line follows the live run. */
  until?: number;
  axis?: PlotAxis;
  /** Key labels for the series and the dashed reference. */
  keys?: { series?: string; reference?: string };
  height?: number;
};

/** An SVG path through the finite samples up to `until`, broken at gaps. */
function tracePath(
  t: number[],
  values: number[],
  until: number,
  x: (t: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let shown = 0;
  t.forEach((at, index) => {
    if (at > until + 1e-9) return;
    const value = values[index];
    if (!Number.isFinite(value)) {
      shown = 0;
      return;
    }
    path += `${shown ? "L" : "M"}${x(at).toFixed(1)} ${y(value).toFixed(1)}`;
    shown++;
  });
  return path;
}

/** Gridlines, tick labels and axis titles shared by the lab's plots. */
export function PlotAxes({
  width,
  height,
  x,
  y,
  xScale,
  yScale,
  xTitle,
  yTitle,
}: {
  width: number;
  height: number;
  x: (value: number) => number;
  y: (value: number) => number;
  xScale: Scale;
  yScale: Scale;
  xTitle: string;
  yTitle: string;
}) {
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  return (
    <>
      <g className="lab-plot-grid">
        {yScale.ticks.map((tick) => (
          <line
            key={`y${tick}`}
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={y(tick)}
            y2={y(tick)}
          />
        ))}
        {xScale.ticks.map((tick) => (
          <line
            key={`x${tick}`}
            x1={x(tick)}
            x2={x(tick)}
            y1={MARGIN.top}
            y2={height - MARGIN.bottom}
          />
        ))}
      </g>
      <g className="lab-plot-axis">
        {yScale.ticks.map((tick) => (
          <text
            key={`y${tick}`}
            x={MARGIN.left - 6}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {tick.toFixed(yScale.digits)}
          </text>
        ))}
        {xScale.ticks.map((tick) => (
          <text
            key={`x${tick}`}
            x={x(tick)}
            y={height - MARGIN.bottom + 14}
            textAnchor="middle"
          >
            {tick.toFixed(xScale.digits)}
          </text>
        ))}
        <text
          x={MARGIN.left + innerWidth / 2}
          y={height - 4}
          textAnchor="middle"
        >
          {xTitle}
        </text>
        <text
          transform={`translate(12 ${MARGIN.top + innerHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yTitle}
        </text>
      </g>
    </>
  );
}

/**
 * A series plot (DESIGN.md §6, Plot): a probe series revealed up to the live value over a
 * dashed reference (a closed-form curve or solver samples), with axis titles in SI units and a
 * hover readout. The horizontal axis is time unless `axis` names another quantity.
 */
export function Plot({
  series,
  curve,
  reference,
  domain,
  until = Infinity,
  axis = TIME_AXIS,
  keys = {},
  height = 180,
}: PlotProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const width = useWidth(node, 520);
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(domain, 1e-6);
  const curveEnd = curve ? Math.min(curve.until, span) : 0;
  const curveTimes = curve
    ? Array.from(
        { length: CURVE_SAMPLES + 1 },
        (_, index) => (curveEnd * index) / CURVE_SAMPLES,
      )
    : [];
  const curveValues = curve ? curveTimes.map((t) => curve.at(t)) : [];
  const [low, high] = valueRange([
    ...series.values,
    ...curveValues,
    ...(reference?.values ?? []),
  ]);
  const inner = {
    width: width - MARGIN.left - MARGIN.right,
    height: height - MARGIN.top - MARGIN.bottom,
  };
  const x = (t: number) => MARGIN.left + (t / span) * inner.width;
  const y = (value: number) =>
    MARGIN.top + ((high - value) / (high - low)) * inner.height;
  const xScale = niceTicks(0, span, Math.max(2, Math.round(inner.width / 90)));
  const yScale = niceTicks(low, high, 4);

  const path = tracePath(series.t, series.values, until, x, y);
  const dashed =
    tracePath(curveTimes, curveValues, Infinity, x, y) +
    (reference ? tracePath(reference.t, reference.values, Infinity, x, y) : "");
  const referenceAt = (index: number) =>
    reference && reference.t[index] === series.t[index]
      ? reference.values[index]
      : undefined;

  let last = series.t.length - 1;
  while (last >= 0 && series.t[last] > until + 1e-9) last--;
  const hovered =
    hover === null || last < 0
      ? undefined
      : series.t.reduce(
          (best, t, index) =>
            index <= last &&
            Math.abs(t - hover) < Math.abs(series.t[best] - hover)
              ? index
              : best,
          0,
        );

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const t = ((event.clientX - box.left - MARGIN.left) / inner.width) * span;
    setHover(t >= 0 && t <= span ? t : null);
  }

  const axisTitle = `${series.label} (${series.unit})`;
  const hasReference = Boolean(curve || reference);
  const hoveredReference =
    hovered === undefined ? undefined : referenceAt(hovered);
  return (
    <figure className="lab-plot" ref={setNode}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${series.label} against ${axis.label.toLowerCase()}${hasReference ? `, with the ${keys.reference ? `${keys.reference} reference` : "closed-form curve"}` : ""}`}
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
          xTitle={`${axis.label} (${axis.unit})`}
          yTitle={axisTitle}
        />
        {dashed ? <path className="lab-plot-ref" d={dashed} /> : null}
        {path ? (
          <path
            className="lab-plot-line"
            d={path}
            style={{ stroke: series.color }}
          />
        ) : null}
        {hovered !== undefined ? (
          <g className="lab-plot-cursor">
            <line
              x1={x(series.t[hovered])}
              x2={x(series.t[hovered])}
              y1={MARGIN.top}
              y2={height - MARGIN.bottom}
            />
            {Number.isFinite(series.values[hovered]) ? (
              <circle
                cx={x(series.t[hovered])}
                cy={y(series.values[hovered])}
                r={3.5}
                style={{ fill: series.color }}
              />
            ) : null}
          </g>
        ) : null}
      </svg>
      <figcaption className="lab-plot-key">
        {hovered !== undefined ? (
          <span className="num">
            {axis.symbol} {formatValue(series.t[hovered])} {axis.unit} ·{" "}
            {series.symbol} {formatValue(series.values[hovered])} {series.unit}
            {hoveredReference !== undefined
              ? ` · ${keys.reference ?? "Theory"} ${formatValue(hoveredReference)} ${series.unit}`
              : null}
          </span>
        ) : (
          <>
            <span>
              <i
                className="lab-plot-swatch"
                style={{ background: series.color }}
                aria-hidden="true"
              />
              {keys.series ?? "Simulated"}
            </span>
            {hasReference ? (
              <span>
                <i
                  className="lab-plot-swatch lab-plot-swatch--ref"
                  aria-hidden="true"
                />
                {keys.reference ?? "Theory"}
              </span>
            ) : null}
          </>
        )}
      </figcaption>
    </figure>
  );
}
