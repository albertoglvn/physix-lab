import type { MotionRun } from "../motion/run";

export const CSV_COLUMNS = [
  "run_id",
  "t",
  "quantity",
  "value",
  "unit",
  "source",
] as const;

export type CsvRow = {
  run_id: string;
  t: number;
  quantity: string;
  value: number;
  unit: string;
  source: string;
};

const quote = (text: string) =>
  /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** Shortest text that parses back to the same double; NaN is an empty cell. */
const number = (value: number) => (Number.isNaN(value) ? "" : String(value));

/**
 * Tidy long-form CSV of a run: one row per sample and quantity, SI units, with a commented
 * metadata header (LAB_PLAN.md §4.3).
 */
export function runToCsv(runs: MotionRun[]): string {
  const lines: string[] = [];
  for (const run of runs) {
    const { inputs, engine } = run;
    lines.push(
      `# ${run.schema} ${run.id}`,
      `# scene: ${inputs.scene.name} (${inputs.scene.version})`,
      `# engine: ${engine.name} ${engine.version}, ${engine.solverIterations} solver iterations`,
      `# time_step_s: ${inputs.timeStep}`,
      `# probe_rate_hz: ${inputs.rate}`,
      `# stop: ${run.stop.event ? `${run.stop.event.type} of ${run.stop.event.target}` : "time limit"} at ${run.stop.t} s`,
      "# acceleration is a backward finite difference of velocity over one sample",
    );
  }
  lines.push(CSV_COLUMNS.join(","));
  for (const run of runs)
    for (const quantity of run.quantities) {
      const column = run.series.columns[quantity.key];
      run.series.t.forEach((t, index) => {
        lines.push(
          [
            run.id,
            number(t),
            quote(quantity.key),
            number(column[index]),
            quote(quantity.unit),
            quantity.source,
          ].join(","),
        );
      });
    }
  return lines.join("\n") + "\n";
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

/** Reads a tidy run CSV back into rows and its comment lines. */
export function parseRunCsv(text: string): { meta: string[]; rows: CsvRow[] } {
  const meta: string[] = [];
  const rows: CsvRow[] = [];
  let header: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("#")) {
      meta.push(line.slice(1).trim());
      continue;
    }
    const cells = splitRow(line);
    if (!header) {
      header = cells;
      if (header.join(",") !== CSV_COLUMNS.join(","))
        throw new Error(`Expected the columns ${CSV_COLUMNS.join(", ")}.`);
      continue;
    }
    rows.push({
      run_id: cells[0],
      t: Number(cells[1]),
      quantity: cells[2],
      value: cells[3] === "" ? Number.NaN : Number(cells[3]),
      unit: cells[4],
      source: cells[5],
    });
  }
  return { meta, rows };
}
