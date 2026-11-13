import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Bundles the hosted Worker into one ES module plus the physics engine's WebAssembly. The
 * Worker shares the lab's scene builder and motion run (`web/src/lab`) and inlines the
 * hosted stress reference and the chart view. Vite comes from the web package's
 * dependencies.
 *
 * Workers refuse to compile WebAssembly from bytes at run time, which is how the Rapier
 * compatibility package starts. The bundle therefore imports `rapier3d.wasm` as a
 * precompiled module (the `CompiledWasm` rule in wrangler.json) and passes it to Rapier's
 * initializer in place of the inlined bytes. Tests and the browser keep the package as is.
 */
const root = new URL("../", import.meta.url);
const { build } = await import(
  new URL("web/node_modules/vite/dist/node/index.js", root).href
);
const RAPIER = new URL(
  "web/node_modules/@dimforge/rapier3d-compat/dist/",
  root,
);
const WASM = "./rapier3d.wasm";

const output = new URL("dist/server/", root);
const metadata = new URL("dist/.openai/", root);
await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(metadata, { recursive: true }),
]);

/** Swaps Rapier's inlined WebAssembly bytes for the precompiled module import. */
const rapierWasmModule = {
  name: "physix-rapier-wasm-module",
  enforce: "pre",
  resolveId(id) {
    if (id === WASM) return { id: WASM, external: true };
  },
  transform(code, id) {
    if (!/rapier3d-compat[\\/]dist[\\/]rapier\.mjs(?:$|\?)/.test(id)) return;
    const inline =
      /module_or_path:\w+\.toByteArray\("[A-Za-z0-9+/=]+"\)\.buffer/g;
    const found = code.match(inline)?.length ?? 0;
    if (found !== 1)
      throw new Error(
        `Expected one inlined Rapier WebAssembly module, found ${found}; check the Rapier version.`,
      );
    return {
      code: `import __rapierWasm from "${WASM}";\n${code.replace(inline, "module_or_path:__rapierWasm")}`,
      map: null,
    };
  },
};

await build({
  configFile: false,
  root: fileURLToPath(root),
  logLevel: "warn",
  plugins: [rapierWasmModule],
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
const imports = [
  ...bundled.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm),
].map((match) => match[1]);
if (imports.length !== 1 || imports[0] !== WASM)
  throw new Error(
    `The bundled Worker must import only ${WASM}; it imports ${imports.join(", ") || "nothing"}.`,
  );
if (bundled.includes('toByteArray("AGFzbQ'))
  throw new Error("The bundled Worker still inlines Rapier's WebAssembly.");
await copyFile(new URL("rapier_wasm3d_bg.wasm", RAPIER), new URL(WASM, output));

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
        rules: [{ type: "CompiledWasm", globs: ["**/*.wasm"] }],
        assets: { directory: "../client", binding: "ASSETS" },
      },
      null,
      2,
    ) + "\n",
  ),
]);
