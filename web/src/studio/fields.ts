/** Field selection and colour ranges shared by the studio views. */

import { useEffect, useRef, useState } from "react";
import type { Engine, SurrogatePrediction } from "../inference/engine";
import type { Case } from "../physics/case";
import { fitsFrame, PIXELS } from "../physics/encoding";
import { geometryIssues } from "../physics/geometry";
import type { ColormapName, Range } from "../ui/colormap";
import { fieldRange } from "../ui/colormap";
import { mpa } from "../ui/units";

export type FieldKey = "von_mises" | "sxx" | "syy" | "txy" | "spread";

export const FIELD_OPTIONS: {
  value: FieldKey;
  label: string;
  title: string;
}[] = [
  {
    value: "von_mises",
    label: "von Mises",
    title: "Plane-stress von Mises stress",
  },
  { value: "sxx", label: "σxx", title: "Normal stress along x" },
  { value: "syy", label: "σyy", title: "Normal stress along y" },
  { value: "txy", label: "τxy", title: "In-plane shear stress" },
  {
    value: "spread",
    label: "Disagreement",
    title: "Standard deviation of von Mises across the five models",
  },
];

export function colormapFor(key: FieldKey): ColormapName {
  if (key === "spread") return "spread";
  return key === "von_mises" ? "stress" : "diverging";
}

/** Signed components get a symmetric range so zero is always the neutral colour. */
export function rangeFor(
  key: FieldKey,
  values: ArrayLike<number>,
  mask: ArrayLike<number> | null,
): Range {
  const r = fieldRange(values, mask);
  if (key === "von_mises" || key === "spread") return { min: 0, max: r.max };
  const a = Math.max(Math.abs(r.min), Math.abs(r.max)) || 1;
  return { min: -a, max: a };
}

export function surrogateField(
  pred: SurrogatePrediction,
  key: FieldKey,
): Float32Array {
  const { result } = pred;
  switch (key) {
    case "von_mises":
      return result.vonMises;
    case "spread":
      return result.stdVonMises;
    case "sxx":
      return result.mean.subarray(0, PIXELS);
    case "syy":
      return result.mean.subarray(PIXELS, 2 * PIXELS);
    case "txy":
      return result.mean.subarray(2 * PIXELS, 3 * PIXELS);
  }
}

export const formatStress = (v: number) => mpa(v);

export interface SurrogateState {
  pred: SurrogatePrediction | null;
  forCase: Case | null;
  error: string | null;
  blocked: string | null;
}

/**
 * Runs the in-browser ensemble whenever the case changes. Requests coalesce: while one
 * inference runs, only the newest case is kept, so dragging a hole never builds a queue.
 */
export function useSurrogate(engine: Engine | null, c: Case): SurrogateState {
  const [state, setState] = useState<SurrogateState>({
    pred: null,
    forCase: null,
    error: null,
    blocked: null,
  });
  const busy = useRef(false);
  const pending = useRef<Case | null>(null);

  useEffect(() => {
    if (!engine) return;
    const run = async (next: Case) => {
      busy.current = true;
      let current: Case | null = next;
      while (current) {
        pending.current = null;
        const issues = geometryIssues(current);
        if (issues.length) {
          const msg = issues[0].message;
          setState((s) => ({ ...s, blocked: msg, error: null }));
        } else if (!fitsFrame(current)) {
          setState((s) => ({
            ...s,
            blocked:
              "Height exceeds the model frame (half the width); use the FEM check.",
            error: null,
          }));
        } else {
          try {
            const pred = await engine.predict(current);
            setState({ pred, forCase: current, error: null, blocked: null });
          } catch (err) {
            setState((s) => ({
              ...s,
              error: err instanceof Error ? err.message : String(err),
            }));
          }
        }
        current = pending.current;
      }
      busy.current = false;
    };
    // The loop outlives this effect on purpose: it drains `pending` with the newest case.
    if (busy.current) pending.current = c;
    else void run(c);
  }, [engine, c]);

  return state;
}
