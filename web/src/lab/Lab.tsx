import {
  Box,
  CircleDot,
  Code2,
  Download,
  Focus,
  Layers3,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  TriangleRight,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WorkspaceHeader } from "../ui/pastoral";
import { LabViewport } from "./LabViewport";
import {
  blockOnRamp,
  findRampPlacement,
  limits,
  makeObject,
  makeScene,
  OBJECT_LIMIT,
  objectNames,
  parseScene,
  presetNames,
  rampPlacement,
  type LabObject,
  type LabScene,
  type Preset,
  type Ramp,
} from "./scene";
import {
  createSimulation,
  initialBlockState,
  pulleyState,
  TIME_STEP,
  type Simulation,
} from "./simulation";
import "./lab.css";

const icons = { block: Box, ramp: TriangleRight, pulley: CircleDot };
const objectKinds = ["block", "ramp", "pulley"] as const;
const defaultSelection = (scene: LabScene) =>
  (scene.objects.find((object) => object.kind === "block") ?? scene.objects[0])
    ?.id ?? null;
type Runtime = {
  scene: LabScene;
  revision: number;
} & (
  | { simulation: Simulation; error?: never }
  | { simulation?: never; error: string }
);

function NumberField({
  label,
  value,
  range,
  onChange,
}: {
  label: string;
  value: number;
  range: readonly [number, number, number];
  onChange: (value: number) => void;
}) {
  const [min, max, step] = range;
  const text = Number(value.toFixed(4)).toString();
  return (
    <label className="lab-field">
      <span>{label}</span>
      <input
        key={text}
        type="number"
        defaultValue={text}
        min={min}
        max={max}
        step={step}
        onBlur={(event) => {
          const input = event.currentTarget;
          if (input.value === text) return;
          const next = input.valueAsNumber;
          if (!Number.isFinite(next) || next < min || next > max)
            input.value = text;
          else onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ObjectInspector({
  object,
  scene,
  onChange,
  onDelete,
  onPlace,
}: {
  object: LabObject;
  scene: LabScene;
  onChange: (object: LabObject) => void;
  onDelete: () => void;
  onPlace: (ramp: Ramp) => void;
}) {
  const ramps = scene.objects.filter((part) => part.kind === "ramp");
  const Icon = icons[object.kind];
  return (
    <div className="lab-object-inspector" key={object.id}>
      <div className="lab-inspector-title">
        <div>
          <Icon size={16} />
          <h3>{objectNames[object.kind]}</h3>
        </div>
        <button
          type="button"
          className="lab-icon-button lab-delete"
          onClick={onDelete}
          aria-label="Remove selected object"
          title="Remove selected object"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="lab-field-grid">
        <NumberField
          label="X (m)"
          value={object.x}
          range={limits.position}
          onChange={(x) => onChange({ ...object, x })}
        />
        <NumberField
          label="Z (m)"
          value={object.z}
          range={limits.position}
          onChange={(z) => onChange({ ...object, z })}
        />
        {object.kind === "block" && (
          <>
            <NumberField
              label="Height (m)"
              value={object.y}
              range={limits.height}
              onChange={(y) => onChange({ ...object, y })}
            />
            <NumberField
              label="Size (m)"
              value={object.size}
              range={limits.size}
              onChange={(size) => onChange({ ...object, size })}
            />
            <NumberField
              label="Mass (kg)"
              value={object.mass}
              range={limits.mass}
              onChange={(mass) => onChange({ ...object, mass })}
            />
            <NumberField
              label="Tilt (°)"
              value={object.rotation}
              range={limits.rotation}
              onChange={(rotation) => onChange({ ...object, rotation })}
            />
            <NumberField
              label="Initial X speed (m/s)"
              value={object.vx}
              range={limits.velocity}
              onChange={(vx) => onChange({ ...object, vx })}
            />
          </>
        )}
        {object.kind === "ramp" && (
          <>
            <NumberField
              label="Length (m)"
              value={object.length}
              range={limits.length}
              onChange={(length) => onChange({ ...object, length })}
            />
            <NumberField
              label="Width (m)"
              value={object.width}
              range={limits.width}
              onChange={(width) => onChange({ ...object, width })}
            />
            <NumberField
              label="Angle (°)"
              value={object.angle}
              range={limits.angle}
              onChange={(angle) => onChange({ ...object, angle })}
            />
            <NumberField
              label="Friction (μ)"
              value={object.friction}
              range={limits.friction}
              onChange={(friction) => onChange({ ...object, friction })}
            />
          </>
        )}
        {object.kind === "pulley" && (
          <>
            <NumberField
              label="Left mass (kg)"
              value={object.leftMass}
              range={limits.mass}
              onChange={(leftMass) => onChange({ ...object, leftMass })}
            />
            <NumberField
              label="Right mass (kg)"
              value={object.rightMass}
              range={limits.mass}
              onChange={(rightMass) => onChange({ ...object, rightMass })}
            />
          </>
        )}
      </div>
      {object.kind === "block" && ramps.length > 0 && (
        <label className="lab-field lab-placement">
          <span>Place on ramp</span>
          <select
            value=""
            onChange={(event) => {
              const ramp = ramps.find(
                (part) => part.id === event.currentTarget.value,
              );
              if (ramp) onPlace(ramp);
            }}
          >
            <option value="" disabled>
              Choose a ramp
            </option>
            {ramps.map((ramp) => (
              <option key={ramp.id} value={ramp.id}>
                {ramp.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {object.kind === "pulley" && (
        <p className="lab-help">
          Ideal Atwood machine with a massless rope and wheel. Motion ends when
          a weight reaches its stop. Positive acceleration lowers the right
          mass.
        </p>
      )}
    </div>
  );
}

function Measurements({
  scene,
  object,
  simulation,
  time,
}: {
  scene: LabScene;
  object?: LabObject;
  simulation?: Simulation;
  time: number;
}) {
  const items = [{ label: "Time", value: time, unit: "s" }];
  if (object?.kind === "block") {
    const { position, velocity } =
      simulation?.block(object.id) ?? initialBlockState(object);
    items.push(
      {
        label: "Speed",
        value: Math.hypot(velocity.x, velocity.y, velocity.z),
        unit: "m/s",
      },
      { label: "Height", value: position.y, unit: "m" },
      { label: "X position", value: position.x, unit: "m" },
    );
  } else if (object?.kind === "pulley") {
    const state =
      simulation?.pulley(object.id) ?? pulleyState(object, scene.gravity, 0);
    items.push(
      { label: "Rope speed", value: Math.abs(state.speed), unit: "m/s" },
      { label: "Acceleration", value: state.acceleration, unit: "m/s²" },
      {
        label: state.stopped ? "At travel stop" : "Tension",
        value: state.tension ?? NaN,
        unit: "N",
      },
    );
  } else {
    items.push({ label: "Gravity", value: scene.gravity, unit: "m/s²" });
  }
  return (
    <section className="lab-readout" aria-labelledby="measurements-heading">
      <h2 id="measurements-heading">Measurements</h2>
      <dl>
        {items.map(({ label, value, unit }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {Number.isFinite(value) ? (
                <>
                  {value.toFixed(2)} <small>{unit}</small>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function downloadScene(scene: LabScene) {
  const href = URL.createObjectURL(
    new Blob([JSON.stringify(scene, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = href;
  link.download = `${
    scene.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "experiment"
  }.physix.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function Lab({ preset }: { preset: Preset }) {
  const [scene, setScene] = useState(() => makeScene(preset));
  const [selected, setSelected] = useState<string | null>(() =>
    defaultSelection(scene),
  );
  const [source, setSource] = useState<Preset | "custom">(preset);
  const [revision, setRevision] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [runtime, setRuntime] = useState<Runtime>();
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState<{
    simulation: Simulation;
    time: number;
  }>();
  const [editError, setEditError] = useState("");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const jsonDialog = useRef<HTMLDialogElement>(null);
  const jsonFile = useRef<HTMLInputElement>(null);

  const current =
    runtime?.scene === scene && runtime.revision === revision
      ? runtime
      : undefined;
  const simulation = current?.simulation;
  const object = scene.objects.find((part) => part.id === selected);
  const time = clock && clock.simulation === simulation ? clock.time : 0;

  useEffect(() => {
    let cancelled = false;
    let created: Simulation | undefined;
    createSimulation(scene)
      .then((next) => {
        if (cancelled) next.dispose();
        else {
          created = next;
          setRuntime({ scene, revision, simulation: next });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setRuntime({
            scene,
            revision,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [scene, revision]);

  useEffect(() => {
    if (!running || !simulation) return;
    let frame = 0;
    let previous = performance.now();
    let remainder = 0;
    let reported = simulation.time;
    const tick = (now: number) => {
      remainder += Math.max(0, Math.min((now - previous) / 1000, 0.1));
      previous = now;
      const steps = Math.floor(remainder / TIME_STEP);
      if (steps) {
        simulation.step(steps);
        remainder -= steps * TIME_STEP;
        if (simulation.time - reported >= 0.075) {
          reported = simulation.time;
          setClock({ simulation, time: reported });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, simulation]);

  function apply(next: LabScene, nextSelected = selected) {
    try {
      const validated = parseScene(next);
      setRunning(false);
      setScene(validated);
      setSelected(nextSelected);
      setSource("custom");
      setEditError("");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  }

  function selectPreset(next: Preset) {
    if (next === preset) {
      const initial = makeScene(next);
      apply(initial, defaultSelection(initial));
      setSource(next);
      setViewRevision((value) => value + 1);
    } else window.location.hash = `/lab/${next}`;
  }

  function updateObject(next: LabObject) {
    const previous = scene.objects.find((part) => part.id === next.id);
    const objects = scene.objects.map((part) => {
      if (part.id === next.id) return next;
      if (
        part.kind === "block" &&
        previous?.kind === "ramp" &&
        next.kind === "ramp"
      ) {
        const placement = rampPlacement(part, previous);
        if (placement)
          return blockOnRamp(part, next, placement.fraction, placement.lateral);
      }
      return part;
    });
    apply({ ...scene, objects });
  }

  function placeOnRamp(ramp: Ramp) {
    if (object?.kind !== "block") return;
    const placed = findRampPlacement(object, ramp, scene.objects);
    if (placed) updateObject(placed);
    else
      setEditError(
        "This ramp has no available starting position for the selected block.",
      );
  }

  function insert(kind: LabObject["kind"]) {
    let serial = 1;
    while (scene.objects.some((part) => part.id === `${kind}-${serial}`))
      serial++;
    const count = scene.objects.length;
    const x = count === 0 ? 0 : (((count - 1) % 5) - 2) * 2.6;
    const z = count === 0 ? 0 : 3 + Math.floor((count - 1) / 5) * 2.2;
    const part = makeObject(kind, `${kind}-${serial}`, x, z);
    apply({ ...scene, objects: [...scene.objects, part] }, part.id);
  }

  function remove() {
    const objects = scene.objects.filter((part) => part.id !== selected);
    apply({ ...scene, objects }, objects[0]?.id ?? null);
  }

  function reset() {
    setRunning(false);
    setRevision((value) => value + 1);
  }

  function run() {
    if (!simulation) return;
    if (running) setClock({ simulation, time: simulation.time });
    setRunning(!running);
  }

  function advance() {
    if (!simulation) return;
    simulation.step();
    setClock({ simulation, time: simulation.time });
  }

  function openJson() {
    setJson(JSON.stringify(scene, null, 2));
    setJsonError("");
    jsonDialog.current?.showModal();
  }

  function importJson() {
    try {
      const next = parseScene(JSON.parse(json) as unknown);
      apply(next, next.objects[0]?.id ?? null);
      jsonDialog.current?.close();
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="pastoral lab">
      <WorkspaceHeader current="mechanics" />

      <main className="lab-workspace">
        <div className="lab-heading">
          <div>
            <h1>{scene.name}</h1>
            <p>
              Physics lab <span aria-hidden="true">/</span> Mechanics
            </p>
          </div>
          <button className="lab-button" type="button" onClick={openJson}>
            <Code2 size={16} /> Scene JSON
          </button>
        </div>
        {editError && (
          <p className="lab-error" role="alert">
            {editError}
          </p>
        )}

        <div className="lab-layout">
          <aside className="lab-panel lab-tools" aria-label="Experiment tools">
            <section>
              <h2>Start from</h2>
              <label className="lab-preset-picker">
                <span className="lab-sr-only">Experiment preset</span>
                <select
                  value={source}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    if (Object.hasOwn(presetNames, next))
                      selectPreset(next as Preset);
                  }}
                >
                  {source === "custom" && (
                    <option value="custom" disabled>
                      Custom scene
                    </option>
                  )}
                  {Object.entries(presetNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {id === "blank" ? "Blank scene" : name}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <section>
              <h2>Add to scene</h2>
              <div className="lab-tool-list">
                {objectKinds.map((kind) => {
                  const Icon = icons[kind];
                  return (
                    <button
                      type="button"
                      className="lab-add"
                      key={kind}
                      onClick={() => insert(kind)}
                      disabled={scene.objects.length >= OBJECT_LIMIT}
                    >
                      <Icon size={16} />
                      <span>{objectNames[kind]}</span>
                      <Plus size={13} />
                    </button>
                  );
                })}
              </div>
              {scene.objects.length >= OBJECT_LIMIT && (
                <p className="lab-help">Scene limit reached.</p>
              )}
            </section>
            <section>
              <h2>
                <Layers3 size={15} /> Objects{" "}
                <span>{scene.objects.length}</span>
              </h2>
              <ul className="lab-object-list">
                {scene.objects.map((part) => {
                  const Icon = icons[part.kind];
                  return (
                    <li key={part.id}>
                      <button
                        type="button"
                        aria-pressed={part.id === selected}
                        onClick={() => setSelected(part.id)}
                      >
                        <Icon size={14} />
                        <span>{part.id}</span>
                      </button>
                    </li>
                  );
                })}
                {!scene.objects.length && (
                  <li className="lab-help">Add a part to begin.</li>
                )}
              </ul>
            </section>
          </aside>

          <section className="lab-stage" aria-label="Simulation">
            <div className="lab-stage-bar">
              <span>
                <span className="lab-status-dot" data-running={running} />
                {current?.error
                  ? "Unavailable"
                  : !simulation
                    ? "Loading engine"
                    : running
                      ? "Running"
                      : time > 0
                        ? "Paused"
                        : "Ready"}
              </span>
              <button
                className="lab-icon-button"
                type="button"
                aria-label="Reset camera"
                title="Reset camera"
                onClick={() => setViewRevision((value) => value + 1)}
              >
                <Focus size={16} />
              </button>
            </div>
            <div className="lab-stage-window">
              <LabViewport
                scene={scene}
                simulation={simulation}
                selected={selected}
                onSelect={setSelected}
                viewRevision={viewRevision}
              />
              <div className="lab-orbit-hint">
                Drag to orbit · Scroll to zoom
              </div>
            </div>
            {current?.error && (
              <p className="lab-error" role="alert">
                Simulation could not start. {current.error}
              </p>
            )}
            <div className="lab-transport">
              <button
                className="lab-button lab-button--dark"
                type="button"
                onClick={run}
                disabled={!simulation}
              >
                {running ? <Pause size={16} /> : <Play size={16} />}
                {running ? "Pause" : "Run"}
              </button>
              <button
                className="lab-button"
                type="button"
                onClick={advance}
                disabled={!simulation || running}
              >
                <SkipForward size={16} /> Step
              </button>
              <button className="lab-button" type="button" onClick={reset}>
                <RotateCcw size={15} /> Reset
              </button>
              <span>120 steps/s</span>
            </div>
            <Measurements
              scene={scene}
              object={object}
              simulation={simulation}
              time={time}
            />
          </section>

          <aside className="lab-panel lab-inspector" aria-label="Inspector">
            <section>
              <h2>
                <SlidersHorizontal size={15} /> Scene settings
              </h2>
              <label className="lab-field lab-name">
                <span>Name</span>
                <input
                  key={scene.name}
                  defaultValue={scene.name}
                  maxLength={80}
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim();
                    if (name && name !== scene.name) apply({ ...scene, name });
                    else event.currentTarget.value = scene.name;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              <div className="lab-field-grid">
                <NumberField
                  label="Gravity (m/s²)"
                  value={scene.gravity}
                  range={limits.gravity}
                  onChange={(gravity) => apply({ ...scene, gravity })}
                />
                <NumberField
                  label="Floor friction (μ)"
                  value={scene.floorFriction}
                  range={limits.friction}
                  onChange={(floorFriction) =>
                    apply({ ...scene, floorFriction })
                  }
                />
              </div>
            </section>
            <section>
              <h2>Selected object</h2>
              {object ? (
                <ObjectInspector
                  object={object}
                  scene={scene}
                  onChange={updateObject}
                  onDelete={remove}
                  onPlace={placeOnRamp}
                />
              ) : (
                <p className="lab-help">
                  Select an object in the scene to edit its properties.
                </p>
              )}
            </section>
            <p className="lab-help lab-inspector-note">
              Edits apply to the starting state and reset the simulation.
              Coordinates use metres, with Y pointing up.
            </p>
          </aside>
        </div>
      </main>

      <dialog
        className="lab-dialog"
        ref={jsonDialog}
        aria-labelledby="json-heading"
      >
        <div className="lab-dialog-heading">
          <h2 id="json-heading">Scene JSON</h2>
          <button
            type="button"
            className="lab-icon-button"
            aria-label="Close JSON editor"
            onClick={() => jsonDialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p>Edit or import a scene, then apply it to the lab.</p>
        <textarea
          value={json}
          spellCheck={false}
          aria-label="Scene JSON"
          onChange={(event) => {
            setJson(event.currentTarget.value);
            setJsonError("");
          }}
        />
        {jsonError && (
          <p className="lab-error" role="alert">
            {jsonError}
          </p>
        )}
        <input
          type="file"
          accept=".json,application/json"
          hidden
          ref={jsonFile}
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (!file) return;
            if (file.size > 64_000) {
              setJsonError("Choose a JSON file smaller than 64 KB.");
              return;
            }
            try {
              setJson(await file.text());
              setJsonError("");
            } catch {
              setJsonError("The selected file could not be read.");
            }
          }}
        />
        <div className="lab-dialog-actions">
          <button
            className="lab-button"
            type="button"
            onClick={() => jsonFile.current?.click()}
          >
            <Upload size={15} /> Load file
          </button>
          <button
            className="lab-button"
            type="button"
            onClick={() => downloadScene(scene)}
          >
            <Download size={15} /> Export scene
          </button>
          <button
            className="lab-button lab-button--dark"
            type="button"
            onClick={importJson}
          >
            Apply scene
          </button>
        </div>
      </dialog>
    </div>
  );
}
