import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [worker, reference, hosting] = await Promise.all(
  [
    "mcp/sites/worker.mjs",
    "mcp/sites/reference-stress.json",
    ".openai/hosting.json",
  ].map((file) => readFile(new URL(file, root), "utf8")),
);

const output = new URL("dist/server/", root);
const metadata = new URL("dist/.openai/", root);
await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(metadata, { recursive: true }),
]);

const referenceImport =
  'import reference from "./reference-stress.json" with { type: "json" };';
if (!worker.includes(referenceImport))
  throw new Error("Worker reference import is missing.");
const bundled = worker.replace(
  referenceImport,
  `const reference = ${JSON.stringify(JSON.parse(reference))};`,
);
await Promise.all([
  writeFile(new URL("index.js", output), bundled),
  writeFile(new URL("hosting.json", metadata), hosting),
  writeFile(
    new URL("wrangler.json", output),
    JSON.stringify(
      {
        name: "physix",
        main: "index.js",
        compatibility_date: "2026-11-13",
        assets: { directory: "../client", binding: "ASSETS" },
      },
      null,
      2,
    ) + "\n",
  ),
]);
