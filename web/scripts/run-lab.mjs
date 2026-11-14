import { readFileSync } from "node:fs";
import process from "node:process";
import { makeScene, parseScene, presetNames } from "../src/lab/scene.ts";
import { createSimulation, TIME_STEP } from "../src/lab/simulation.ts";

const [path, arg, presetSteps, ...extra] = process.argv.slice(2);
const presetMode = path === "--preset";

try {
  if (
    !path ||
    extra.length ||
    (presetMode ? !Object.hasOwn(presetNames, arg) : presetSteps !== undefined)
  ) {
    throw new Error(
      `Usage: run-lab.mjs <scene.json | -> [steps] or run-lab.mjs --preset <${Object.keys(presetNames).join("|")}> [steps]`,
    );
  }
  const rawSteps = (presetMode ? presetSteps : arg) ?? "120";
  const steps = /^\d+$/.test(rawSteps) ? Number(rawSteps) : NaN;
  if (!Number.isSafeInteger(steps) || steps > 12000) {
    throw new Error("Steps must be an integer from 0 to 12,000.");
  }

  const scene = presetMode
    ? makeScene(arg)
    : parseScene(
        JSON.parse(
          readFileSync(path === "-" ? 0 : path, "utf8").replace(/^\uFEFF/, ""),
        ),
      );
  const simulation = await createSimulation(scene);
  try {
    simulation.step(steps);
    const objects = scene.objects.flatMap(({ id, kind }) => {
      if (kind === "pulley")
        return [{ id, kind, source: "rapier", ...simulation.pulley(id) }];
      if (kind !== "ramp")
        return [{ id, kind, source: "rapier", ...simulation.block(id) }];
      return [];
    });
    process.stdout.write(
      JSON.stringify(
        {
          version: scene.version,
          name: scene.name,
          steps,
          stepSeconds: TIME_STEP,
          time: simulation.time,
          rapierVersion: simulation.rapierVersion,
          objects,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    simulation.dispose();
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
