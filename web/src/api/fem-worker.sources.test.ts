import { describe, expect, it } from "vitest";
import worker from "./fem-worker.ts?raw";

/** Every Python module of the packages the worker loads, keyed like the worker's glob. */
const repo = import.meta.glob<string>(
  [
    "../../../physics/*.py",
    "../../../data/*.py",
    "../../../model/*.py",
    "../../../mcp/physix_mcp/*.py",
  ],
  { eager: true, query: "?raw", import: "default" },
);

/** Expands the worker's `dir/{a,b}.py` patterns into file paths. */
function bundled(): Set<string> {
  const block = /import\.meta\.glob<string>\(\s*\[([\s\S]*?)\]/.exec(worker);
  if (!block) throw new Error("fem-worker.ts has no source glob");
  const files = new Set<string>();
  for (const [, pattern] of block[1].matchAll(/"([^"]+)"/g)) {
    const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(pattern);
    const names = brace ? brace[2].split(",") : [""];
    for (const name of names)
      files.add(brace ? `${brace[1]}${name}${brace[3]}` : pattern);
  }
  return files;
}

const PACKAGES: Record<string, string> = {
  physics: "../../../physics",
  data: "../../../data",
  model: "../../../model",
  physix_mcp: "../../../mcp/physix_mcp",
};

/**
 * Imports the worker never reaches: the service loads the ONNX runtime lazily inside a
 * `try`, and the browser runs the ensemble in JavaScript instead.
 */
const NOT_IN_BROWSER = new Set(["../../../model/runtime.py"]);

/** Physix modules a source imports, at top level or inside a function. */
function imports(source: string): string[] {
  const out: string[] = [];
  for (const [, pkg, mod] of source.matchAll(
    /^\s*(?:from|import)\s+(physics|data|model|physix_mcp)\.(\w+)/gm,
  ))
    out.push(`${PACKAGES[pkg]}/${mod}.py`);
  return out;
}

describe("browser FEM worker sources", () => {
  const files = bundled();

  it("bundles files that exist", () => {
    expect(files.size).toBeGreaterThan(10);
    for (const file of files) expect(repo, file).toHaveProperty([file]);
  });

  it("bundles every Physix module the bundled sources import", () => {
    const missing = [...files].flatMap((file) =>
      imports(repo[file] ?? "")
        .filter((dep) => !files.has(dep) && !NOT_IN_BROWSER.has(dep))
        .map((dep) => `${file} imports ${dep}`),
    );
    expect(missing).toEqual([]);
  });
});
