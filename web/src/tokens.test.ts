import { describe, expect, it } from "vitest";
import {
  documentViewportPalette,
  readViewportPalette,
  VIEWPORT_TOKENS,
} from "./lab/viewportPalette";

/** Files that may hold literal colours (DESIGN.md §2). */
const ALLOWED = new Set(["tokens.css", "ui/colormap.ts"]);

type Fs = {
  readdirSync: (dir: URL, options: { recursive: true }) => string[];
  readFileSync: (file: URL, encoding: "utf8") => string;
};
// Read the tree from disk: Vitest does not serve raw CSS through Vite imports.
const fsModule: string = "node:fs";
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;
const root = new URL("./", import.meta.url);
const sources: Record<string, string> = Object.fromEntries(
  fs
    .readdirSync(root, { recursive: true })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.(css|tsx?)$/.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => [path, fs.readFileSync(new URL(path, root), "utf8")]),
);
const tokensCss = sources["tokens.css"] ?? "";

const LITERALS: [string, RegExp][] = [
  ["hex colour", /#[0-9a-fA-F]{3,8}\b/g],
  ["rgb/hsl colour", /\b(?:rgba?|hsla?)\(\s*[\d.]/g],
  ["three.js colour", /\b0x[0-9a-fA-F]{6}\b/g],
  [
    "named colour",
    /(?:color|background|fill|stroke|border(?:-color)?)\s*:\s*(?:white|black|red|green|blue|gr[ae]y|silver)\b/g,
  ],
];

const defined = new Set(
  [...tokensCss.matchAll(/^\s*(--px-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);

describe("design tokens", () => {
  it("scans the source tree", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(sources["lab/lab.css"]).toContain("--px-");
    expect(defined.size).toBeGreaterThan(50);
  });

  it("keep literal colours inside tokens.css and the colour maps", () => {
    const found: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (ALLOWED.has(path)) continue;
      for (const [kind, pattern] of LITERALS) {
        for (const match of text.matchAll(pattern)) {
          const line = text.slice(0, match.index).split("\n").length;
          found.push(`${path}:${line} ${kind} ${match[0]}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("only reference tokens that tokens.css defines", () => {
    const missing = new Set<string>();
    for (const [path, text] of Object.entries(sources)) {
      for (const match of text.matchAll(/--px-[a-z0-9-]+/g)) {
        if (!defined.has(match[0])) missing.add(`${path} ${match[0]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe("viewport palette", () => {
  it("maps every viewport role to a defined token", () => {
    for (const token of Object.values(VIEWPORT_TOKENS)) {
      expect(defined.has(token), token).toBe(true);
    }
  });

  it("reads token values and fails loudly when one is missing", () => {
    const values = new Map(
      [...tokensCss.matchAll(/^\s*(--px-[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map(
        (m) => [m[1], m[2]],
      ),
    );
    const palette = readViewportPalette((token) => values.get(token) ?? "");
    expect(palette.background).toBe(values.get("--px-viewport-bg"));
    expect(palette.block).toBe(values.get("--px-part-block"));
    expect(() => readViewportPalette(() => " ")).toThrow(
      "Missing design token --px-viewport-bg",
    );
    expect(typeof documentViewportPalette).toBe("function");
  });
});
