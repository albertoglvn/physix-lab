import type { Case, Geometry, Hole, LoadKind } from "./case";
import { geometryIssues } from "./geometry";

/**
 * Parses an untrusted `physix.case/1` value, such as one decoded from a share link, and
 * applies the limits of `physics/case.py` (`case_from_dict` and `validate_case`) plus the
 * client geometry checks. The lab supports clamped parts only. The solver stays
 * authoritative; this keeps a crafted link from opening a part the lab cannot draw.
 */

export const MAX_HOLES = 6;

export class CaseParseError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "CaseParseError";
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function object(value: unknown, field: string): Json {
  if (!isObject(value))
    throw new CaseParseError(`Missing object '${field}'.`, field);
  return value;
}

function number(data: Json, key: string, prefix = ""): number {
  const field = `${prefix}${key}`;
  const value = data[key];
  if (value === undefined || value === null)
    throw new CaseParseError(`Missing required field '${field}'.`, field);
  if (typeof value !== "number")
    throw new CaseParseError(`Field '${field}' must be a number.`, field);
  if (!Number.isFinite(value))
    throw new CaseParseError(`Field '${field}' must be finite.`, field);
  return value;
}

export function parseCase(input: unknown): Case {
  const data = object(input, "case");
  if (data.schema !== "physix.case/1")
    throw new CaseParseError(
      "The case schema must be 'physix.case/1'.",
      "schema",
    );
  const family = data.family;
  if (family !== "plate" && family !== "bracket")
    throw new CaseParseError(
      "Field 'family' must be 'plate' or 'bracket'.",
      "family",
    );

  const geo = object(data.geometry, "geometry");
  if (!Array.isArray(geo.holes))
    throw new CaseParseError(
      "Field 'geometry.holes' must be a list.",
      "geometry.holes",
    );
  if (geo.holes.length > MAX_HOLES)
    throw new CaseParseError(
      `At most ${MAX_HOLES} holes are supported.`,
      "geometry.holes",
    );
  const holes: Hole[] = geo.holes.map((raw, i) => {
    const prefix = `geometry.holes[${i}].`;
    const hole = object(raw, `geometry.holes[${i}]`);
    return {
      x: number(hole, "x", prefix),
      y: number(hole, "y", prefix),
      radius: number(hole, "radius", prefix),
    };
  });
  const geometry: Geometry = {
    width: number(geo, "width", "geometry."),
    height: number(geo, "height", "geometry."),
    holes,
  };
  if (family === "bracket") {
    geometry.web_width = number(geo, "web_width", "geometry.");
    geometry.flange_height = number(geo, "flange_height", "geometry.");
    geometry.fillet_radius = number(geo, "fillet_radius", "geometry.");
  }

  const mat = object(data.material, "material");
  const name = mat.name ?? "custom";
  if (typeof name !== "string" || name.length > 64)
    throw new CaseParseError(
      "Field 'material.name' must be a short string.",
      "material.name",
    );
  const material = {
    name,
    young: number(mat, "young", "material."),
    poisson: number(mat, "poisson", "material."),
  };

  const rawLoad = object(data.load, "load");
  const kind = rawLoad.kind ?? "traction";
  if (kind !== "traction" && kind !== "force")
    throw new CaseParseError(
      "Field 'load.kind' must be 'traction' or 'force'.",
      "load.kind",
    );
  const load = {
    kind: kind as LoadKind,
    x: number(rawLoad, "x", "load."),
    y: number(rawLoad, "y", "load."),
  };

  const support = data.support ?? "clamped";
  if (support !== "clamped")
    throw new CaseParseError("The lab supports clamped parts only.", "support");

  const parsed: Case = {
    schema: "physix.case/1",
    family,
    geometry,
    thickness: number(data, "thickness"),
    material,
    support,
    load,
  };
  checkLimits(parsed);
  return parsed;
}

/** The numeric limits of `validate_case`, then the client geometry checks. */
function checkLimits(c: Case): void {
  const g = c.geometry;
  if (!(g.width >= 1e-3 && g.width <= 10))
    throw new CaseParseError(
      "geometry.width must lie in [0.001, 10] m.",
      "geometry.width",
    );
  if (!(g.height >= 0.05 * g.width && g.height <= 2 * g.width))
    throw new CaseParseError(
      "geometry.height must lie in [0.05, 2] times the width.",
      "geometry.height",
    );
  if (!(c.thickness > 0))
    throw new CaseParseError("thickness must be positive.", "thickness");
  if (c.thickness > 0.25 * Math.min(g.width, g.height))
    throw new CaseParseError(
      "The part is too thick for plane stress (thickness above a quarter of its smaller side).",
      "thickness",
    );
  const issue = geometryIssues(c)[0];
  if (issue) throw new CaseParseError(issue.message, issue.field);
  const m = c.material;
  if (!(m.young >= 1e6 && m.young <= 2e12))
    throw new CaseParseError(
      "material.young must lie in [1e6, 2e12] Pa.",
      "material.young",
    );
  if (!(m.poisson >= 0 && m.poisson < 0.5))
    throw new CaseParseError(
      "material.poisson must lie in [0, 0.5).",
      "material.poisson",
    );
  const area =
    (c.family === "plate" ? g.height : (g.flange_height ?? 0)) * c.thickness;
  const scale = c.load.kind === "traction" ? 1 : 1 / area;
  const traction = Math.hypot(c.load.x, c.load.y) * scale;
  if (!(traction > 0))
    throw new CaseParseError("The load must be non-zero.", "load");
  if (traction > 1e11)
    throw new CaseParseError(
      "Traction magnitude must not exceed 1e11 Pa.",
      "load",
    );
}
