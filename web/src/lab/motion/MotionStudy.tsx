import {
  Box,
  CircleDot,
  Code2,
  Download,
  Focus,
  Home,
  Info,
  Keyboard,
  LayoutTemplate,
  ListTree,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  TriangleRight,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { labHash, replaceHash, type Study } from "../../routes";
import {
  LabFrame,
  NameField,
  ShortcutsSheet,
  StatusDot,
  UndoRedo,
  useLabPanels,
  type StatusTone,
} from "../LabFrame";
import { LabViewport } from "../LabViewport";
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
} from "../scene";
import { createSimulation, TIME_STEP, type Simulation } from "../simulation";
import { useShortcuts } from "../shortcuts";
import { useHistory } from "../state/history";
import { Dock } from "../ui/Dock";
import { FloatingPanel } from "../ui/FloatingPanel";
import type { RailItem } from "../ui/Rail";
import { Sheet } from "../ui/Sheet";
import { toasts } from "../ui/toastStore";
import { UnitInput } from "../ui/UnitInput";
import { measure, summarize } from "./measurements";

const icons = { block: Box, ramp: TriangleRight, pulley: CircleDot };
const objectKinds = ["block", "ramp", "pulley"] as const;
const TEMPLATE_NOTES: Record<Preset, string> = {
  incline: "Block sliding down a rough ramp",
  friction: "Two surfaces, one launch speed",
  pulley: "Ideal Atwood machine",
  blank: "Empty floor",
};

type Runtime = {
  scene: LabScene;
  revision: number;
} & (
  | { simulation: Simulation; error?: never }
  | { simulation?: never; error: string }
);

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const DEG = Math.PI / 180;
/** Degrees stored in the scene, shown through an angle field that works in radians. */
const toDegrees = (radians: number) => Number((radians / DEG).toFixed(9));
const range = (limit: readonly [number, number, number], scale = 1) => ({
  min: limit[0] * scale,
  max: limit[1] * scale,
});

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

function ObjectFields({
  object,
  onChange,
}: {
  object: LabObject;
  onChange: (object: LabObject) => void;
}) {
  const position = (
    <>
      <UnitInput
        label="X"
        dimension="length"
        unit="m"
        value={object.x}
        {...range(limits.position)}
        onCommit={(x) => onChange({ ...object, x })}
      />
      <UnitInput
        label="Z"
        dimension="length"
        unit="m"
        value={object.z}
        {...range(limits.position)}
        onCommit={(z) => onChange({ ...object, z })}
      />
    </>
  );
  if (object.kind === "block")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Height"
          dimension="length"
          unit="m"
          value={object.y}
          {...range(limits.height)}
          onCommit={(y) => onChange({ ...object, y })}
        />
        <UnitInput
          label="Size"
          dimension="length"
          unit="m"
          value={object.size}
          {...range(limits.size)}
          onCommit={(size) => onChange({ ...object, size })}
        />
        <UnitInput
          label="Mass"
          dimension="mass"
          unit="kg"
          value={object.mass}
          {...range(limits.mass)}
          onCommit={(mass) => onChange({ ...object, mass })}
        />
        <UnitInput
          label="Tilt"
          dimension="angle"
          unit="deg"
          value={object.rotation * DEG}
          {...range(limits.rotation, DEG)}
          onCommit={(rotation) =>
            onChange({ ...object, rotation: toDegrees(rotation) })
          }
        />
        <UnitInput
          label="Initial X speed"
          dimension="velocity"
          unit="m/s"
          value={object.vx}
          {...range(limits.velocity)}
          onCommit={(vx) => onChange({ ...object, vx })}
        />
      </div>
    );
  if (object.kind === "ramp")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Length"
          dimension="length"
          unit="m"
          value={object.length}
          {...range(limits.length)}
          onCommit={(length) => onChange({ ...object, length })}
        />
        <UnitInput
          label="Width"
          dimension="length"
          unit="m"
          value={object.width}
          {...range(limits.width)}
          onCommit={(width) => onChange({ ...object, width })}
        />
        <UnitInput
          label="Angle"
          dimension="angle"
          unit="deg"
          value={object.angle * DEG}
          {...range(limits.angle, DEG)}
          onCommit={(angle) => onChange({ ...object, angle: toDegrees(angle) })}
        />
        <UnitInput
          label="Friction μ"
          dimension="ratio"
          unit=""
          value={object.friction}
          {...range(limits.friction)}
          onCommit={(friction) => onChange({ ...object, friction })}
        />
      </div>
    );
  return (
    <div className="lab-fields">
      {position}
      <UnitInput
        label="Left mass"
        dimension="mass"
        unit="kg"
        value={object.leftMass}
        {...range(limits.mass)}
        onCommit={(leftMass) => onChange({ ...object, leftMass })}
      />
      <UnitInput
        label="Right mass"
        dimension="mass"
        unit="kg"
        value={object.rightMass}
        {...range(limits.mass)}
        onCommit={(rightMass) => onChange({ ...object, rightMass })}
      />
    </div>
  );
}

export type MotionStudyProps = {
  active: boolean;
  template?: Preset;
  onStudyChange: (study: Study) => void;
};

/** Rigid-body motion: the former mechanics lab inside the shared shell. */
export function MotionStudy({
  active,
  template = "incline",
  onStudyChange,
}: MotionStudyProps) {
  const history = useHistory(() => makeScene(template));
  const scene = history.value;
  const [selected, setSelected] = useState<string | null>(
    () =>
      (scene.objects.find((part) => part.kind === "block") ?? scene.objects[0])
        ?.id ?? null,
  );
  const [revision, setRevision] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [runtime, setRuntime] = useState<Runtime>();
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState<{
    simulation: Simulation;
    time: number;
  }>();
  const [sheet, setSheet] = useState<"json" | "keys" | null>(null);
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const jsonFile = useRef<HTMLInputElement>(null);
  const panels = useLabPanels();

  const current =
    runtime?.scene === scene && runtime.revision === revision
      ? runtime
      : undefined;
  const simulation = current?.simulation;
  const object = scene.objects.find((part) => part.id === selected);
  const time = clock && clock.simulation === simulation ? clock.time : 0;
  const select = useCallback((id: string | null) => setSelected(id), []);

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
        if (cancelled) return;
        setRuntime({ scene, revision, error: message(error) });
        toasts.push({
          tone: "bad",
          message: `The simulation could not start. ${message(error)}`,
        });
      });
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [scene, revision]);

  useEffect(() => {
    if (!running || !simulation || !active) return;
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
  }, [running, simulation, active]);

  /** Validates and commits an edit as one undo step. Returns false when it was rejected. */
  function apply(next: LabScene, nextSelected = selected): boolean {
    try {
      const validated = parseScene(next);
      setRunning(false);
      history.set(validated);
      setSelected(nextSelected);
      return true;
    } catch (error) {
      toasts.push({ tone: "bad", message: message(error) });
      return false;
    }
  }

  function loadTemplate(next: Preset) {
    const initial = makeScene(next);
    const first =
      initial.objects.find((part) => part.kind === "block") ??
      initial.objects[0];
    if (apply(initial, first?.id ?? null)) {
      setViewRevision((value) => value + 1);
      replaceHash(labHash({ study: "motion", template: next }));
    }
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
      toasts.push({
        tone: "warn",
        message: `${ramp.id} has no free starting position for ${object.id}.`,
      });
  }

  function insert(kind: LabObject["kind"]) {
    let serial = 1;
    while (scene.objects.some((part) => part.id === `${kind}-${serial}`))
      serial++;
    const count = scene.objects.length;
    const x = count === 0 ? 0 : (((count - 1) % 5) - 2) * 2.6;
    const z = count === 0 ? 0 : 3 + Math.floor((count - 1) / 5) * 2.2;
    const part = makeObject(kind, `${kind}-${serial}`, x, z);
    if (apply({ ...scene, objects: [...scene.objects, part] }, part.id))
      panels.setInspectorOpen(true);
  }

  function remove() {
    if (!object) return;
    const objects = scene.objects.filter((part) => part.id !== object.id);
    if (apply({ ...scene, objects }, null))
      toasts.push({
        tone: "info",
        message: `Removed ${object.id}. Press Ctrl Z to undo.`,
      });
  }

  function undo() {
    setRunning(false);
    history.undo();
  }

  function redo() {
    setRunning(false);
    history.redo();
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
    if (!simulation || running) return;
    simulation.step();
    setClock({ simulation, time: simulation.time });
  }

  function openJson() {
    setJson(JSON.stringify(scene, null, 2));
    setJsonError("");
    setSheet("json");
  }

  function importJson() {
    try {
      const next = parseScene(JSON.parse(json) as unknown);
      if (apply(next, next.objects[0]?.id ?? null)) {
        setSheet(null);
        setViewRevision((value) => value + 1);
      }
    } catch (error) {
      setJsonError(message(error));
    }
  }

  useShortcuts(active && sheet === null, {
    run,
    step: advance,
    reset,
    frame: () => setViewRevision((value) => value + 1),
    delete: remove,
    deselect: () => setSelected(null),
    undo,
    redo,
  });

  const engine: { value: string; tone: StatusTone } = current?.error
    ? { value: "Unavailable", tone: "bad" }
    : !simulation
      ? { value: "Loading", tone: "busy" }
      : running
        ? { value: "Running", tone: "ok" }
        : { value: time > 0 ? "Paused" : "Ready", tone: "idle" };
  const readings = measure(scene, object, simulation, time);
  const ramps = scene.objects.filter((part) => part.kind === "ramp");
  const full = scene.objects.length >= OBJECT_LIMIT;

  const rail: RailItem[] = [
    {
      id: "add",
      label: "Add part",
      icon: <Plus size={18} aria-hidden="true" />,
      content: (close) => (
        <>
          <ul className="px-pick-list">
            {objectKinds.map((kind) => {
              const Icon = icons[kind];
              return (
                <li key={kind}>
                  <button
                    type="button"
                    className="px-pick"
                    disabled={full}
                    onClick={() => {
                      insert(kind);
                      close();
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {objectNames[kind]}
                  </button>
                </li>
              );
            })}
          </ul>
          {full ? (
            <p className="lab-note">
              The scene holds at most {OBJECT_LIMIT} parts.
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: "templates",
      label: "Templates",
      icon: <LayoutTemplate size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          {(Object.keys(presetNames) as Preset[]).map((id) => (
            <li key={id}>
              <button
                type="button"
                className="px-pick"
                onClick={() => {
                  loadTemplate(id);
                  close();
                }}
              >
                <LayoutTemplate size={15} aria-hidden="true" />
                {id === "blank" ? "Blank scene" : presetNames[id]}
                <small>{TEMPLATE_NOTES[id]}</small>
              </button>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "outline",
      label: "Outline",
      icon: <ListTree size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          <li>
            <button
              type="button"
              className="px-pick"
              aria-pressed={selected === null}
              onClick={() => {
                setSelected(null);
                panels.setInspectorOpen(true);
                close();
              }}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              Scene
            </button>
          </li>
          {scene.objects.map((part) => {
            const Icon = icons[part.kind];
            return (
              <li key={part.id}>
                <button
                  type="button"
                  className="px-pick"
                  aria-pressed={part.id === selected}
                  onClick={() => {
                    setSelected(part.id);
                    panels.setInspectorOpen(true);
                    close();
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {part.id}
                </button>
              </li>
            );
          })}
        </ul>
      ),
    },
  ];

  const ObjectIcon = object ? icons[object.kind] : SlidersHorizontal;

  return (
    <LabFrame
      study="motion"
      active={active}
      onStudyChange={onStudyChange}
      documentTitle={`${scene.name} · Physix`}
      title={
        <>
          <NameField
            label="Experiment name"
            value={scene.name}
            onCommit={(name) => apply({ ...scene, name })}
          />
          <UndoRedo
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        </>
      }
      controls={
        <>
          <button
            type="button"
            className="lab-button lab-button--dark lab-run"
            onClick={run}
            disabled={!simulation}
            title="Run or pause (Space)"
          >
            {running ? (
              <Pause size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {running ? "Pause" : "Run"}
          </button>
          <button
            type="button"
            className="lab-button lab-secondary"
            onClick={advance}
            disabled={!simulation || running}
            title="Step 1/120 s (.)"
          >
            <SkipForward size={15} aria-hidden="true" />
            <span>Step</span>
          </button>
          <button
            type="button"
            className="lab-button lab-secondary"
            onClick={reset}
            title="Reset the run (R)"
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>Reset</span>
          </button>
        </>
      }
      status={
        <StatusDot label="Engine" value={engine.value} tone={engine.tone} />
      }
      menu={[
        {
          label: "Scene JSON",
          icon: <Code2 size={15} />,
          onSelect: openJson,
        },
        {
          label: "Export scene",
          icon: <Download size={15} />,
          onSelect: () => downloadScene(scene),
        },
        {
          label: "Reset camera",
          icon: <Focus size={15} />,
          hint: "F",
          onSelect: () => setViewRevision((value) => value + 1),
        },
        {
          label: "Keyboard shortcuts",
          icon: <Keyboard size={15} />,
          onSelect: () => setSheet("keys"),
        },
        "separator",
        {
          label: "Home",
          icon: <Home size={15} />,
          onSelect: () => {
            window.location.hash = "/";
          },
        },
      ]}
      railLabel="Scene tools"
      rail={rail}
      sheets={
        <>
          <Sheet
            open={sheet === "json"}
            title="Scene JSON"
            wide
            onClose={() => setSheet(null)}
          >
            <p className="lab-sheet-lead">
              Edit or paste a <code>physix.lab/1</code> scene in SI units, then
              apply it. Applying is one undo step.
            </p>
            <textarea
              className="lab-json"
              value={json}
              spellCheck={false}
              aria-label="Scene JSON"
              onChange={(event) => {
                setJson(event.currentTarget.value);
                setJsonError("");
              }}
            />
            {jsonError ? (
              <p className="lab-error" role="alert">
                {jsonError}
              </p>
            ) : null}
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
            <div className="lab-sheet-actions">
              <button
                className="lab-button"
                type="button"
                onClick={() => jsonFile.current?.click()}
              >
                <Upload size={15} aria-hidden="true" /> Load file
              </button>
              <button
                className="lab-button"
                type="button"
                onClick={() => downloadScene(scene)}
              >
                <Download size={15} aria-hidden="true" /> Export
              </button>
              <button
                className="lab-button lab-button--dark"
                type="button"
                onClick={importJson}
              >
                Apply scene
              </button>
            </div>
          </Sheet>
          <ShortcutsSheet
            open={sheet === "keys"}
            onClose={() => setSheet(null)}
          />
        </>
      }
    >
      <LabViewport
        scene={scene}
        simulation={simulation}
        selected={selected}
        onSelect={select}
        viewRevision={viewRevision}
      />
      <div className="lab-hud">
        <button
          type="button"
          className="px-icon-button lab-hud-button"
          aria-label="Reset camera"
          title="Reset camera (F)"
          onClick={() => setViewRevision((value) => value + 1)}
        >
          <Focus size={16} aria-hidden="true" />
        </button>
        <span className="lab-hint">Drag to orbit · Scroll to zoom</span>
      </div>

      <FloatingPanel
        title={object ? object.id : "Scene"}
        anchor="right"
        icon={<ObjectIcon size={15} aria-hidden="true" />}
        collapsed={!panels.inspectorOpen}
        onCollapsedChange={(collapsed) => panels.setInspectorOpen(!collapsed)}
        className="lab-inspector"
        actions={
          object ? (
            <>
              {object.kind === "pulley" ? (
                <span
                  className="lab-info"
                  role="img"
                  aria-label="Ideal Atwood machine with a massless rope and wheel. Motion ends when a weight reaches its stop. Positive acceleration lowers the right mass."
                  title="Ideal Atwood machine with a massless rope and wheel. Motion ends when a weight reaches its stop. Positive acceleration lowers the right mass."
                >
                  <Info size={15} aria-hidden="true" />
                </span>
              ) : null}
              <button
                type="button"
                className="px-icon-button lab-delete"
                aria-label={`Remove ${object.id}`}
                title="Remove (Delete)"
                onClick={remove}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </>
          ) : null
        }
      >
        {object ? (
          <div key={object.id}>
            <p className="lab-kind">{objectNames[object.kind]}</p>
            <ObjectFields object={object} onChange={updateObject} />
            {object.kind === "block" && ramps.length > 0 ? (
              <label className="lab-select">
                <span>Place on ramp</span>
                <select
                  className="px-input"
                  value=""
                  onChange={(event) => {
                    const ramp = ramps.find(
                      (part) => part.id === event.currentTarget.value,
                    );
                    if (ramp) placeOnRamp(ramp);
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
            ) : null}
          </div>
        ) : (
          <div className="lab-fields">
            <UnitInput
              label="Gravity"
              dimension="acceleration"
              unit="m/s²"
              value={scene.gravity}
              {...range(limits.gravity)}
              onCommit={(gravity) => apply({ ...scene, gravity })}
            />
            <UnitInput
              label="Floor friction μ"
              dimension="ratio"
              unit=""
              value={scene.floorFriction}
              {...range(limits.friction)}
              onCommit={(floorFriction) => apply({ ...scene, floorFriction })}
            />
          </div>
        )}
        <p className="lab-note">
          Edits set the starting state and reset the run. Metres, Y up.
        </p>
      </FloatingPanel>

      <Dock
        title="Data"
        summary={summarize(readings)}
        open={panels.dockOpen}
        onOpenChange={panels.setDockOpen}
        maxFraction={panels.dockMaxFraction}
        defaultHeight={220}
      >
        <dl className="lab-readout">
          {readings.map(({ label, value, unit }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="num">
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
      </Dock>
    </LabFrame>
  );
}
