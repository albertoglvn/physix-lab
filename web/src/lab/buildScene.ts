/**
 * Builds a validated Motion scene from a short request (`physix.scene-request/1`), so an
 * agent can describe a problem by naming parts and the values that matter, while every
 * other field takes the lab's default. The hosted `build_scene` tool and the lab share
 * this module; `parseScene` stays the final authority on every value.
 *
 * Imports carry `.ts` so the hosted Worker's tests can load this file directly in Node.
 */
import {
  blockOnRamp,
  bodyDepth,
  bodyHalf,
  isBody,
  launchVelocity,
  limits,
  makeObject,
  makeScene,
  materialNames,
  MATERIALS,
  OBJECT_LIMIT,
  parseScene,
  PENDULUM_LINKS,
  presetNames,
  radians,
  SCENE_VERSION,
  withMaterial,
  type Body,
  type LabObject,
  type LabScene,
  type MaterialName,
  type Preset,
  type Ramp,
} from "./scene.ts";

export const SCENE_REQUEST_SCHEMA = "physix.scene-request/1";

type Kind = LabObject["kind"];
type LimitKey = keyof typeof limits;
type Field = { limit: LimitKey; unit: string; about: string };

const KINDS: readonly Kind[] = [
  "block",
  "ball",
  "cylinder",
  "ramp",
  "pulley",
  "pendulum",
  "spring",
];

const placement: Record<string, Field> = {
  x: {
    limit: "position",
    unit: "m",
    about: "horizontal position, +x to the right",
  },
  z: { limit: "position", unit: "m", about: "depth position" },
};
const body: Record<string, Field> = {
  y: { limit: "height", unit: "m", about: "centre height above the floor" },
  mass: { limit: "mass", unit: "kg", about: "mass" },
  vx: { limit: "velocity", unit: "m/s", about: "initial velocity along x" },
  vy: {
    limit: "velocity",
    unit: "m/s",
    about: "initial velocity along y (up)",
  },
  restitution: { limit: "restitution", unit: "1", about: "bounciness, 0 to 1" },
  friction: {
    limit: "friction",
    unit: "1",
    about:
      "own friction coefficient; the smaller of the two in contact applies",
  },
  dragCoefficient: {
    limit: "dragCoefficient",
    unit: "1",
    about:
      "quadratic drag coefficient C_d; the shape's typical value by default",
  },
};

/** Numeric fields a request may set on each kind, with their units. */
export const PART_FIELDS: Record<Kind, Record<string, Field>> = {
  block: {
    ...placement,
    ...body,
    size: { limit: "size", unit: "m", about: "edge length of the cube" },
    rotation: { limit: "rotation", unit: "deg", about: "rotation about z" },
  },
  ball: {
    ...placement,
    ...body,
    radius: { limit: "radius", unit: "m", about: "radius of the solid sphere" },
  },
  cylinder: {
    ...placement,
    ...body,
    radius: { limit: "radius", unit: "m", about: "radius" },
    length: {
      limit: "cylinderLength",
      unit: "m",
      about: "length along z; it rolls along x",
    },
  },
  ramp: {
    ...placement,
    length: { limit: "length", unit: "m", about: "horizontal run" },
    width: { limit: "width", unit: "m", about: "extent along z" },
    angle: {
      limit: "angle",
      unit: "deg",
      about: "incline; it rises towards −x",
    },
    friction: {
      limit: "friction",
      unit: "1",
      about: "surface friction coefficient",
    },
  },
  pulley: {
    ...placement,
    leftMass: { limit: "mass", unit: "kg", about: "left hanging mass" },
    rightMass: { limit: "mass", unit: "kg", about: "right hanging mass" },
    wheelMass: {
      limit: "wheelMass",
      unit: "kg",
      about: "uniform-disc wheel mass; 0 for a massless wheel",
    },
  },
  pendulum: {
    ...placement,
    pivotHeight: { limit: "pivotHeight", unit: "m", about: "pivot height" },
    length: {
      limit: "pendulumLength",
      unit: "m",
      about: "pivot to bob centre",
    },
    mass: { limit: "mass", unit: "kg", about: "bob mass" },
    bobRadius: { limit: "bobRadius", unit: "m", about: "bob radius" },
    angle: {
      limit: "swing",
      unit: "deg",
      about:
        "release angle from straight down, anticlockwise positive; released from rest",
    },
    rodMass: {
      limit: "rodMass",
      unit: "kg",
      about: "uniform rod mass; 0 for a light rod and always 0 for a rope",
    },
  },
  spring: {
    ...placement,
    anchorHeight: { limit: "pivotHeight", unit: "m", about: "anchor height" },
    stiffness: { limit: "stiffness", unit: "N/m", about: "spring constant" },
    damping: { limit: "damping", unit: "N·s/m", about: "viscous damping" },
    restLength: { limit: "restLength", unit: "m", about: "unstretched length" },
    mass: { limit: "mass", unit: "kg", about: "cube mass" },
    size: { limit: "size", unit: "m", about: "cube edge" },
    offset: {
      limit: "offset",
      unit: "m",
      about:
        "release position above the hanging equilibrium; released from rest",
    },
  },
};

const SCENE_FIELDS: Record<string, Field> = {
  gravity: { limit: "gravity", unit: "m/s²", about: "acts along −y" },
  floorFriction: { limit: "friction", unit: "1", about: "floor friction" },
  airDensity: {
    limit: "airDensity",
    unit: "kg/m³",
    about: "quadratic drag on free bodies; 0 is a vacuum, 1.2 is sea-level air",
  },
  linearDrag: {
    limit: "linearDrag",
    unit: "N·s/m",
    about: "linear drag b v on free bodies",
  },
};

const BODY_EXTRAS = ["material", "force", "launch", "on_ramp"] as const;
const PENDULUM_EXTRAS = ["link"] as const;
const REQUEST_KEYS = [
  "name",
  "template",
  "objects",
  ...Object.keys(SCENE_FIELDS),
];

export class SceneRequestError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "SceneRequestError";
    this.field = field;
  }
}

export type BuiltScene = {
  scene: LabScene;
  /** The fields each part took from the lab's defaults, by part ID. */
  defaults: Record<string, string[]>;
};

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function record(value: unknown, field: string): Json {
  if (!isRecord(value))
    throw new SceneRequestError(`${field} must be an object.`, field);
  return value;
}

function onlyKeys(value: Json, allowed: readonly string[], field: string) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined)
    throw new SceneRequestError(
      `${field} has no field '${extra}'. Use: ${allowed.join(", ")}.`,
      `${field}.${extra}`,
    );
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new SceneRequestError(`${field} must be a finite number.`, field);
  return value;
}

const isPreset = (value: unknown): value is Preset =>
  typeof value === "string" && Object.hasOwn(presetNames, value);

/** One part from its request, before ramp placement. */
function buildPart(input: unknown, index: number, used: Set<string>) {
  const field = `objects[${index}]`;
  const raw = record(input, field);
  const kind = raw.kind as Kind;
  if (!KINDS.includes(kind))
    throw new SceneRequestError(
      `${field}.kind must be one of ${KINDS.join(", ")}.`,
      `${field}.kind`,
    );
  const numbers = PART_FIELDS[kind];
  const extras =
    kind === "pendulum"
      ? PENDULUM_EXTRAS
      : kind === "block" || kind === "ball" || kind === "cylinder"
        ? BODY_EXTRAS
        : [];
  onlyKeys(raw, ["kind", "id", ...Object.keys(numbers), ...extras], field);

  let id = raw.id;
  if (id === undefined) {
    let n = 1;
    while (used.has(`${kind}-${n}`)) n++;
    id = `${kind}-${n}`;
  }
  if (typeof id !== "string" || used.has(id))
    throw new SceneRequestError(
      `${field}.id must be a unique string.`,
      `${field}.id`,
    );
  used.add(id);

  let part: LabObject = makeObject(kind, id);
  const given: string[] = [];
  if (raw.material !== undefined) {
    if (!materialNames.includes(raw.material as MaterialName))
      throw new SceneRequestError(
        `${field}.material must be one of ${materialNames.join(", ")}.`,
        `${field}.material`,
      );
    part = withMaterial(part as Body, raw.material as MaterialName);
    given.push("material", "friction", "restitution");
  }
  for (const key of Object.keys(numbers)) {
    if (raw[key] === undefined) continue;
    (part as Json)[key] = finite(raw[key], `${field}.${key}`);
    given.push(key);
  }
  if (raw.link !== undefined) {
    (part as Json).link = raw.link;
    given.push("link");
    if (raw.link === "rope" && raw.rodMass === undefined)
      (part as Json).rodMass = 0;
  }
  if (raw.force !== undefined) {
    (part as Json).force = raw.force;
    given.push("force");
  }
  if (raw.launch !== undefined) {
    if (raw.vx !== undefined || raw.vy !== undefined)
      throw new SceneRequestError(
        `${field}: give either launch or vx and vy, not both.`,
        `${field}.launch`,
      );
    const launch = record(raw.launch, `${field}.launch`);
    onlyKeys(launch, ["speed", "elevation"], `${field}.launch`);
    const speed = finite(launch.speed, `${field}.launch.speed`);
    const elevation = finite(launch.elevation, `${field}.launch.elevation`);
    Object.assign(part, launchVelocity(speed, elevation));
    given.push("vx", "vy");
  }
  return { field, raw, part, given };
}

/** Places a body on a ramp of the same request, as the lab does when it is dropped on. */
function placeOnRamp(
  built: ReturnType<typeof buildPart>,
  parts: LabObject[],
): LabObject {
  const { field, raw } = built;
  const request = record(raw.on_ramp, `${field}.on_ramp`);
  onlyKeys(request, ["ramp", "fraction"], `${field}.on_ramp`);
  for (const key of ["x", "y", "z", "vx", "vy", "rotation", "launch"])
    if (raw[key] !== undefined)
      throw new SceneRequestError(
        `${field}: a part placed on a ramp starts at rest at its place there, so leave out ${key}.`,
        `${field}.${key}`,
      );
  const ramp = parts.find(
    (part): part is Ramp => part.kind === "ramp" && part.id === request.ramp,
  );
  if (!ramp)
    throw new SceneRequestError(
      `${field}.on_ramp.ramp must name a ramp in objects.`,
      `${field}.on_ramp.ramp`,
    );
  const bodyPart = built.part as Body;
  const fraction =
    request.fraction === undefined
      ? 0.23
      : finite(request.fraction, `${field}.on_ramp.fraction`);
  const edge =
    (bodyHalf(bodyPart) * Math.cos(radians(ramp.angle))) / ramp.length;
  if (fraction < edge || fraction > 1 - edge)
    throw new SceneRequestError(
      `${field}.on_ramp.fraction must lie between ${edge.toFixed(3)} and ${(1 - edge).toFixed(3)} so the part sits on the ramp (0 is the top, 1 the foot).`,
      `${field}.on_ramp.fraction`,
    );
  if (bodyDepth(bodyPart) > ramp.width)
    throw new SceneRequestError(
      `${field} is deeper than ${ramp.id} is wide.`,
      `${field}.on_ramp`,
    );
  built.given.push("x", "y", "z", "vx", "vy");
  if (bodyPart.kind === "block") built.given.push("rotation");
  return blockOnRamp(bodyPart, ramp, fraction);
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Builds and validates a scene. With `objects`, the request's parts replace the template's;
 * without, the template is kept and only the scene-wide fields change.
 */
export function buildScene(input: unknown): BuiltScene {
  const request = record(input ?? {}, "request");
  onlyKeys(request, REQUEST_KEYS, "request");
  const template = request.template ?? "blank";
  if (!isPreset(template))
    throw new SceneRequestError(
      `template must be one of ${Object.keys(presetNames).join(", ")}.`,
      "template",
    );
  const scene: Json = { ...makeScene(template) };
  if (request.name !== undefined) scene.name = request.name;
  for (const key of Object.keys(SCENE_FIELDS))
    if (request[key] !== undefined) scene[key] = finite(request[key], key);

  const defaults: Record<string, string[]> = {};
  if (request.objects !== undefined) {
    if (
      !Array.isArray(request.objects) ||
      request.objects.length > OBJECT_LIMIT
    )
      throw new SceneRequestError(
        `objects must be a list of at most ${OBJECT_LIMIT} parts.`,
        "objects",
      );
    const used = new Set<string>();
    const built = request.objects.map((raw, i) => buildPart(raw, i, used));
    const parts = built.map(({ part }) => part);
    built.forEach((entry, i) => {
      if (entry.raw.on_ramp !== undefined && isBody(entry.part))
        parts[i] = placeOnRamp(entry, parts);
    });
    built.forEach((entry, i) => {
      // Validate each part alone, so an error names the part it belongs to.
      try {
        parseScene({ ...scene, objects: [parts[i]] });
      } catch (error) {
        if (error instanceof SceneRequestError) throw error;
        const key = /^([a-zA-Z]+(?:\.[a-z]+)?) must/.exec(reason(error))?.[1];
        throw new SceneRequestError(
          `${entry.field} (${parts[i].id}): ${reason(error)}`,
          key ? `${entry.field}.${key}` : entry.field,
        );
      }
      const set = new Set(["id", "kind", ...entry.given]);
      defaults[parts[i].id] = Object.keys(parts[i]).filter(
        (key) => !set.has(key),
      );
    });
    scene.objects = parts;
  }
  try {
    return { scene: parseScene(scene), defaults };
  } catch (error) {
    throw new SceneRequestError(reason(error));
  }
}

const range = (key: LimitKey) => {
  const [min, max] = limits[key];
  return { min, max };
};

function describeFields(fields: Record<string, Field>, defaults?: Json) {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      {
        unit: field.unit,
        ...range(field.limit),
        ...(defaults && typeof defaults[name] === "number"
          ? { default: defaults[name] }
          : {}),
        about: field.about,
      },
    ]),
  );
}

/** The Motion domain for agents: conventions, templates, parts, fields and limits. */
export function motionDomain() {
  const blank = makeScene("blank");
  return {
    schema: SCENE_REQUEST_SCHEMA,
    scene_version: SCENE_VERSION,
    conventions:
      "SI units, angles in degrees. +x is to the right, +y is up and z is depth; the floor is the plane y = 0 and gravity acts along −y. Parts start at rest unless given a velocity.",
    templates: presetNames,
    object_limit: OBJECT_LIMIT,
    scene_fields: describeFields(SCENE_FIELDS, blank as unknown as Json),
    parts: Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        describeFields(
          PART_FIELDS[kind],
          makeObject(kind, "x") as unknown as Json,
        ),
      ]),
    ),
    materials: Object.fromEntries(
      materialNames.map((name) => {
        const { friction, restitution } = MATERIALS[name];
        return [name, { friction, restitution }];
      }),
    ),
    body_options: {
      material:
        "A library material for a block, ball or cylinder: sets its friction and restitution; the mass stays as given.",
      launch:
        "{speed (m/s), elevation (deg above +x)} instead of vx and vy for a free body.",
      force:
        "{x, y (N, ±500), start, end (s, 0 to 60)}: a constant force on a free body over that interval.",
      on_ramp:
        "{ramp (a ramp id in objects), fraction (0 top to 1 foot, default 0.23)}: places a block, ball or cylinder at rest on that ramp's surface.",
    },
    pendulum_link: `${PENDULUM_LINKS.join(" or ")}; a rope only pulls, so it goes slack when the bob moves inwards.`,
  };
}

/** JSON Schema of a request, for the hosted tool's input. */
export function sceneRequestSchema() {
  const numberProps = (fields: Record<string, Field>) =>
    Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [
        name,
        {
          type: "number",
          ...(() => {
            const { min, max } = range(field.limit);
            return { minimum: min, maximum: max };
          })(),
          description: `${field.about} (${field.unit})`,
        },
      ]),
    );
  const allPartFields = Object.assign({}, ...Object.values(PART_FIELDS));
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", maxLength: 80, description: "Scene title." },
      template: {
        type: "string",
        enum: Object.keys(presetNames),
        description:
          "Starting template, default blank. Its parts are replaced when objects is given.",
      },
      ...numberProps(SCENE_FIELDS),
      objects: {
        type: "array",
        maxItems: OBJECT_LIMIT,
        description:
          "Parts of the scene. Give only the values that matter; describe_domain lists each kind's fields and defaults.",
        items: {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: KINDS },
            id: {
              type: "string",
              pattern: "^[a-zA-Z0-9_-]{1,48}$",
              description: "Unique part id, default <kind>-<n>.",
            },
            ...numberProps(allPartFields),
            material: { type: "string", enum: materialNames },
            link: { type: "string", enum: PENDULUM_LINKS },
            launch: {
              type: "object",
              additionalProperties: false,
              required: ["speed", "elevation"],
              properties: {
                speed: { type: "number", description: "m/s" },
                elevation: { type: "number", description: "deg above +x" },
              },
            },
            force: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y", "start", "end"],
              properties: {
                x: { type: "number", description: "N" },
                y: { type: "number", description: "N" },
                start: { type: "number", description: "s" },
                end: { type: "number", description: "s" },
              },
            },
            on_ramp: {
              type: "object",
              additionalProperties: false,
              required: ["ramp"],
              properties: {
                ramp: { type: "string", description: "A ramp id in objects." },
                fraction: {
                  type: "number",
                  description: "0 at the top to 1 at the foot, default 0.23.",
                },
              },
            },
          },
        },
      },
    },
  };
}
