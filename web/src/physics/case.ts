/**
 * physix.case/1 in TypeScript. SI units throughout (m, Pa, N); conversion to mm and MPa
 * happens only in UI formatting (`ui/units.ts`).
 */

export type Family = "plate" | "bracket";
export type LoadKind = "traction" | "force";

export interface Hole {
  x: number;
  y: number;
  radius: number;
}

export interface Geometry {
  width: number;
  height: number;
  holes: Hole[];
  web_width?: number;
  flange_height?: number;
  fillet_radius?: number;
}

export interface Material {
  name: string;
  young: number;
  poisson: number;
}

export interface Load {
  kind: LoadKind;
  x: number;
  y: number;
}

export interface Case {
  schema: "physix.case/1";
  family: Family;
  geometry: Geometry;
  thickness: number;
  material: Material;
  support: "clamped";
  load: Load;
}

export const MATERIALS: Record<string, Material & { label: string; yield: number }> = {
  steel: { name: "steel", label: "Structural steel", young: 210e9, poisson: 0.3, yield: 250e6 },
  stainless_304: {
    name: "stainless_304",
    label: "Stainless 304",
    young: 193e9,
    poisson: 0.29,
    yield: 215e6,
  },
  aluminium_6061: {
    name: "aluminium_6061",
    label: "Aluminium 6061-T6",
    young: 68.9e9,
    poisson: 0.33,
    yield: 276e6,
  },
  titanium_ti6al4v: {
    name: "titanium_ti6al4v",
    label: "Titanium Ti-6Al-4V",
    young: 113.8e9,
    poisson: 0.342,
    yield: 880e6,
  },
  pmma: { name: "pmma", label: "PMMA (acrylic)", young: 3.2e9, poisson: 0.37, yield: 70e6 },
};

export function examplePlate(): Case {
  return {
    schema: "physix.case/1",
    family: "plate",
    geometry: { width: 0.2, height: 0.08, holes: [{ x: 0.1, y: 0.04, radius: 0.012 }] },
    thickness: 0.005,
    material: { name: "steel", young: 210e9, poisson: 0.3 },
    support: "clamped",
    load: { kind: "traction", x: 10e6, y: 0 },
  };
}

export function exampleBracket(): Case {
  return {
    schema: "physix.case/1",
    family: "bracket",
    geometry: {
      width: 0.2,
      height: 0.1,
      web_width: 0.04,
      flange_height: 0.03,
      fillet_radius: 0.008,
      holes: [{ x: 0.02, y: 0.07, radius: 0.008 }],
    },
    thickness: 0.005,
    material: { name: "aluminium_6061", young: 68.9e9, poisson: 0.33 },
    support: "clamped",
    load: { kind: "force", x: 0, y: -500 },
  };
}

export function loadEdgeLength(c: Case): number {
  return c.family === "plate" ? c.geometry.height : (c.geometry.flange_height ?? 0);
}

/** Equivalent uniform traction (Pa) on the load edge. */
export function traction(c: Case): [number, number] {
  if (c.load.kind === "traction") return [c.load.x, c.load.y];
  const area = loadEdgeLength(c) * c.thickness;
  return [c.load.x / area, c.load.y / area];
}

export function resultantForce(c: Case): [number, number] {
  const [tx, ty] = traction(c);
  const area = loadEdgeLength(c) * c.thickness;
  return [tx * area, ty * area];
}

export function tractionMagnitude(c: Case): number {
  const [tx, ty] = traction(c);
  return Math.hypot(tx, ty);
}

export function yieldStrength(c: Case): number | null {
  return MATERIALS[c.material.name]?.yield ?? null;
}

export function cloneCase(c: Case): Case {
  return JSON.parse(JSON.stringify(c)) as Case;
}
