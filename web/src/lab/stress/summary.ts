import { mpa, pct } from "../../ui/units";

export type StressReadout = {
  peak?: number;
  safety: number | null;
  kt: number | null;
  disagreement?: number;
  source: string;
};

/** The single collapsed dock line; the expanded dock holds the full readout. */
export function stressSummary({
  peak,
  safety,
  kt,
  disagreement,
  source,
}: StressReadout): string {
  return [
    `peak ${mpa(peak)}`,
    `SF ${safety != null ? safety.toFixed(2) : "—"}`,
    `Kt ${kt != null ? kt.toFixed(2) : "—"}`,
    `spread ${pct(disagreement)}`,
    source,
  ].join(" · ");
}
