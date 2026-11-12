/** The scikit-fem mesh with nodal von Mises, drawn on a canvas (y up, metres). */

import { useEffect, useMemo, useRef } from "react";
import { decodeFloat32, decodeInt32, type MeshPayload } from "../api/client";
import { lut, type Range } from "./colormap";

export function MeshView({
  mesh,
  range,
  showEdges = true,
}: {
  mesh: MeshPayload;
  range: Range;
  showEdges?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(
    () => ({
      pts: decodeFloat32(mesh.points),
      tris: decodeInt32(mesh.triangles),
      vm: decodeFloat32(mesh.von_mises),
    }),
    [mesh],
  );
  const bounds = useMemo(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < data.pts.length; k += 2) {
      x0 = Math.min(x0, data.pts[k]);
      x1 = Math.max(x1, data.pts[k]);
      y0 = Math.min(y0, data.pts[k + 1]);
      y1 = Math.max(y1, data.pts[k + 1]);
    }
    return { x0, y0, x1, y1 };
  }, [data]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const pad = 12;
      const sx = (cssW - 2 * pad) / (bounds.x1 - bounds.x0);
      const cssH = (bounds.y1 - bounds.y0) * sx + 2 * pad;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const X = (x: number) => pad + (x - bounds.x0) * sx;
      const Y = (y: number) => cssH - pad - (y - bounds.y0) * sx;
      const table = lut("stress");
      const span = range.max - range.min || 1;
      const { pts, tris, vm } = data;
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(10, 14, 22, 0.45)";
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t];
        const b = tris[t + 1];
        const c = tris[t + 2];
        const v = (vm[a] + vm[b] + vm[c]) / 3;
        const idx = Math.round(
          Math.min(Math.max((v - range.min) / span, 0), 1) * 255,
        );
        ctx.fillStyle = `rgb(${table[3 * idx]}, ${table[3 * idx + 1]}, ${table[3 * idx + 2]})`;
        ctx.beginPath();
        ctx.moveTo(X(pts[2 * a]), Y(pts[2 * a + 1]));
        ctx.lineTo(X(pts[2 * b]), Y(pts[2 * b + 1]));
        ctx.lineTo(X(pts[2 * c]), Y(pts[2 * c + 1]));
        ctx.closePath();
        ctx.fill();
        if (showEdges) ctx.stroke();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data, bounds, range, showEdges]);

  return (
    <canvas
      ref={ref}
      className="meshview"
      aria-label={`Finite-element mesh, ${mesh.n_triangles} triangles`}
    />
  );
}
