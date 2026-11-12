/**
 * A stress field on the physix.raster/1 grid with the part drawn on top: outline, holes,
 * clamped edge, load arrows and hotspot. Everything lives in one SVG whose user units are
 * metres, so the raster and the geometry can never drift apart. Holes can be dragged.
 */

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Case, Hole } from "../physics/case";
import { traction } from "../physics/case";
import { COLS, ROWS, pixelSize } from "../physics/encoding";
import { loadSegment, outlinePath, supportSegment } from "../physics/geometry";
import { gradientCss, paint, type ColormapName, type Range } from "./colormap";
import { mm } from "./units";

export interface Marker {
  x: number;
  y: number;
  label?: string;
  tone?: "hot" | "ref";
}

export interface FieldViewProps {
  c: Case;
  values: Float32Array | null;
  mask: Uint8Array | null;
  range: Range;
  colormap: ColormapName;
  markers?: Marker[];
  editable?: boolean;
  onHolesChange?: (holes: Hole[]) => void;
  formatValue?: (v: number) => string;
  showLoads?: boolean;
  ghost?: Case | null;
  className?: string;
  ariaLabel?: string;
}

function rasterUrl(
  values: Float32Array | null,
  mask: Uint8Array | null,
  range: Range,
  cmap: ColormapName,
): string | null {
  if (!values || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = COLS;
  canvas.height = ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(COLS, ROWS);
  paint(values, mask, range, cmap, img.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

type Drag = {
  kind: "move" | "resize";
  index: number;
  pointerId: number;
  dx: number;
  dy: number;
} | null;

const snap = (v: number) => Math.round(v * 1e4) / 1e4; // 0.1 mm

export function FieldView({
  c,
  values,
  mask,
  range,
  colormap,
  markers = [],
  editable = false,
  onHolesChange,
  formatValue,
  showLoads = true,
  ghost = null,
  className,
  ariaLabel,
}: FieldViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    v: number | null;
    px: number;
    py: number;
  } | null>(null);

  const w = c.geometry.width;
  const h = c.geometry.height;
  const dx = pixelSize(c);
  const frameH = ROWS * dx;
  const m = 0.07 * w;
  const top = Math.max(frameH - h - m, -m);
  const Y = (y: number) => frameH - y;

  const url = useMemo(
    () => rasterUrl(values, mask, range, colormap),
    [values, mask, range, colormap],
  );
  const outline = useMemo(() => outlinePath(c), [c]);
  const ghostOutline = useMemo(
    () => (ghost ? outlinePath(ghost) : null),
    [ghost],
  );

  const toModel = (e: {
    clientX: number;
    clientY: number;
  }): [number, number] | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      ctm.inverse(),
    );
    return [pt.x, frameH - pt.y];
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toModel(e);
    if (!p) return;
    const [x, y] = p;
    if (drag && onHolesChange) {
      const holes = c.geometry.holes.map((hole) => ({ ...hole }));
      const hole = holes[drag.index];
      if (drag.kind === "move") {
        hole.x = snap(Math.min(Math.max(x - drag.dx, 0), w));
        hole.y = snap(Math.min(Math.max(y - drag.dy, 0), h));
      } else {
        hole.radius = snap(
          Math.max(Math.hypot(x - hole.x, y - hole.y), 0.002 * w),
        );
      }
      onHolesChange(holes);
      return;
    }
    const j = Math.floor(x / dx);
    const i = Math.floor((frameH - y) / dx);
    const inside = i >= 0 && i < ROWS && j >= 0 && j < COLS;
    const k = i * COLS + j;
    const v =
      inside && values && (!mask || mask[k]) && Number.isFinite(values[k])
        ? values[k]
        : null;
    const rect = svgRef.current!.getBoundingClientRect();
    setHover(
      inside
        ? { x, y, v, px: e.clientX - rect.left, py: e.clientY - rect.top }
        : null,
    );
  };

  const startDrag = (
    e: ReactPointerEvent,
    index: number,
    kind: "move" | "resize",
  ) => {
    if (!editable || !onHolesChange) return;
    e.stopPropagation();
    e.preventDefault();
    const p = toModel(e);
    if (!p) return;
    const hole = c.geometry.holes[index];
    svgRef.current?.setPointerCapture(e.pointerId);
    setDrag({
      kind,
      index,
      pointerId: e.pointerId,
      dx: p[0] - hole.x,
      dy: p[1] - hole.y,
    });
    setHover(null);
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag) svgRef.current?.releasePointerCapture(drag.pointerId);
    setDrag(null);
    if (e.type === "pointerleave") setHover(null);
  };

  // Load arrows along the loaded edge, pointing along the applied traction.
  const arrows = useMemo(() => {
    if (!showLoads) return [];
    const [tx, ty] = traction(c);
    const mag = Math.hypot(tx, ty);
    if (!(mag > 0)) return [];
    const ux = tx / mag;
    const uy = ty / mag;
    const s = loadSegment(c);
    const len = 0.075 * w;
    const n = Math.max(
      3,
      Math.round(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / (0.025 * w)),
    );
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = s.x0 + t * (s.x1 - s.x0);
      const py = s.y0 + t * (s.y1 - s.y0);
      // Tension starts at the edge and points away; compression ends at the edge.
      if (ux >= 0)
        out.push({ x0: px, y0: py, x1: px + len * ux, y1: py + len * uy });
      else out.push({ x0: px - len * ux, y0: py - len * uy, x1: px, y1: py });
    }
    return out;
  }, [c, showLoads, w]);

  const support = useMemo(() => {
    const s = supportSegment(c);
    const ticks: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    const n = Math.max(4, Math.round(L / (0.02 * w)));
    // Outward normal: left edge for plates, top of the web for brackets.
    const vertical = Math.abs(s.x1 - s.x0) < 1e-12;
    const nx = vertical ? -1 : 0;
    const ny = vertical ? 0 : 1;
    const hl = 0.025 * w;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const px = s.x0 + t * (s.x1 - s.x0);
      const py = s.y0 + t * (s.y1 - s.y0);
      ticks.push({
        x0: px,
        y0: py,
        x1: px + hl * (nx + (vertical ? 0 : -0.7)),
        y1: py + hl * (ny + (vertical ? -0.7 : 0)),
      });
    }
    return { s, ticks };
  }, [c, w]);

  const fmt = formatValue ?? ((v: number) => v.toPrecision(3));
  const viewH = frameH + m - top;

  return (
    <div className={`fieldview ${className ?? ""}`}>
      <svg
        ref={svgRef}
        viewBox={`${-m} ${top} ${w + 2 * m} ${viewH}`}
        role="img"
        aria-label={ariaLabel ?? "Stress field"}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        style={{
          aspectRatio: `${w + 2 * m} / ${viewH}`,
          cursor: drag ? "grabbing" : undefined,
        }}
      >
        <defs>
          <marker
            id="fv-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fv-arrowhead" />
          </marker>
          <pattern
            id="fv-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="fv-hatchline" />
          </pattern>
        </defs>
        <g transform={`translate(0 ${frameH}) scale(1 -1)`}>
          <path d={outline} className="fv-shadow" />
        </g>
        {url && (
          <image
            href={url}
            x={0}
            y={0}
            width={w}
            height={frameH}
            preserveAspectRatio="none"
            className="fv-raster"
          />
        )}
        <g transform={`translate(0 ${frameH}) scale(1 -1)`}>
          {ghostOutline && (
            <path
              d={ghostOutline}
              className="fv-ghost"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={outline}
            className="fv-outline"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g className="fv-support">
          {support.ticks.map((t, k) => (
            <line
              key={k}
              x1={t.x0}
              y1={Y(t.y0)}
              x2={t.x1}
              y2={Y(t.y1)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={support.s.x0}
            y1={Y(support.s.y0)}
            x2={support.s.x1}
            y2={Y(support.s.y1)}
            className="fv-support-edge"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g className="fv-loads">
          {arrows.map((a, k) => (
            <line
              key={k}
              x1={a.x0}
              y1={Y(a.y0)}
              x2={a.x1}
              y2={Y(a.y1)}
              markerEnd="url(#fv-arrow)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {c.geometry.holes.map((hole, k) => (
          <g
            key={k}
            className={`fv-hole ${editable ? "is-editable" : ""} ${drag?.index === k ? "is-active" : ""}`}
          >
            <circle
              cx={hole.x}
              cy={Y(hole.y)}
              r={Math.max(hole.radius, 0)}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => startDrag(e, k, "move")}
            >
              <title>{`Hole ${k + 1}: x ${mm(hole.x)}, y ${mm(hole.y)}, r ${mm(hole.radius)}`}</title>
            </circle>
            {editable && (
              <circle
                className="fv-handle"
                cx={hole.x + hole.radius}
                cy={Y(hole.y)}
                r={0.008 * w}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(e) => startDrag(e, k, "resize")}
              >
                <title>Drag to resize</title>
              </circle>
            )}
          </g>
        ))}
        {markers.map((mk, k) => (
          <g
            key={k}
            className={`fv-marker ${mk.tone === "ref" ? "is-ref" : ""}`}
          >
            <circle
              cx={mk.x}
              cy={Y(mk.y)}
              r={0.014 * w}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={mk.x - 0.024 * w}
              y1={Y(mk.y)}
              x2={mk.x - 0.016 * w}
              y2={Y(mk.y)}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={mk.x + 0.016 * w}
              y1={Y(mk.y)}
              x2={mk.x + 0.024 * w}
              y2={Y(mk.y)}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      {markers
        .filter((mk) => mk.label)
        .map((mk, k) => (
          <div
            key={k}
            className={`fv-tag ${mk.tone === "ref" ? "is-ref" : ""}`}
            style={{
              left: `${((mk.x + m) / (w + 2 * m)) * 100}%`,
              top: `${((Y(mk.y) - top) / viewH) * 100}%`,
            }}
          >
            {mk.label}
          </div>
        ))}
      {hover && !drag && (
        <div className="fv-readout" style={{ left: hover.px, top: hover.py }}>
          <span>{hover.v === null ? "outside the part" : fmt(hover.v)}</span>
          <small>
            x {mm(hover.x, 3)} · y {mm(hover.y, 3)}
          </small>
        </div>
      )}
    </div>
  );
}

export function Colorbar({
  range,
  colormap,
  label,
  format,
}: {
  range: Range;
  colormap: ColormapName;
  label: string;
  format: (v: number) => string;
}) {
  const mid = 0.5 * (range.min + range.max);
  return (
    <div className="colorbar">
      <span className="colorbar-label">{label}</span>
      <div
        className="colorbar-bar"
        style={{ background: gradientCss(colormap, "to right") }}
      />
      <div className="colorbar-ticks">
        <span>{format(range.min)}</span>
        <span>{format(mid)}</span>
        <span>{format(range.max)}</span>
      </div>
    </div>
  );
}
