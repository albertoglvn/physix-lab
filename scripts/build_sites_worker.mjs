import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Bundles the hosted Worker into one ES module. The Worker shares the lab's scene builder
 * (`web/src/lab/buildScene.ts`) and inlines the hosted stress reference, so the deployed
 * file has no imports. Vite comes from the web package's dependencies.
 */
const root = new URL("../", import.meta.url);
const { build } = await import(
  new URL("web/node_modules/vite/dist/node/index.js", root).href
);

const output = new URL("dist/server/", root);
const metadata = new URL("dist/.openai/", root);
await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(metadata, { recursive: true }),
]);

await build({
  configFile: false,
  root: fileURLToPath(root),
  logLevel: "warn",
  ssr: { noExternal: true, target: "webworker" },
  build: {
    ssr: fileURLToPath(new URL("mcp/sites/worker.mjs", root)),
    outDir: fileURLToPath(output),
    emptyOutDir: false,
    minify: false,
    target: "es2022",
    copyPublicDir: false,
    rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
  },
});

const bundled = await readFile(new URL("index.js", output), "utf8");
if (/^\s*import\s[^;]*from\s/m.test(bundled))
  throw new Error("The bundled Worker still imports other modules.");

const hosting = await readFile(new URL(".openai/hosting.json", root), "utf8");
await Promise.all([
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
